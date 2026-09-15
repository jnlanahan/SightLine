import Anthropic from "@anthropic-ai/sdk";
import type {
  AppMode,
  CaptureFrame,
  Clarification,
  ClarificationResponse,
  ConversationTurn,
  GoalEvaluation,
  InstructionResponse,
  SessionPlan,
} from "./types";
import { getKey } from "./credentials";
import { toContextResolution } from "./capture";
import { logLine } from "./log";
import type { SpeechChunk } from "./speech-chunker";
import { extractJson } from "./instruction-parse";
import { getAgent } from "./agents/registry";
import { MODULE_DETAIL_PROMPT } from "./agents/training";
import { outlineForPrompt } from "./training-plan";
import type { CurriculumOutline, ModuleTaskDetail } from "./training-plan";
import type { TrainingPlan } from "./db/schema";
import { runAgentTurn } from "./agents/harness/runner";
import { newPlanDraft, type ToolDeps } from "./agents/harness/types";
import { applyPlanEdits } from "./agents/tools/plan";

// Re-exported so main.ts's error handling is unaffected by the harness move.
export { MissingApiKeyError, RateLimitError } from "./agents/harness/errors";
import { MissingApiKeyError } from "./agents/harness/errors";

const MODEL = "claude-sonnet-4-6";

// Anthropic's server-side web search. The planners lean on it for current
// menu paths and product behaviour; the agent's mid-turn search_web tool is
// built on it too. This is the variant with dynamic filtering, supported on
// Sonnet 4.6 and later; an account or model that rejects it gets the same
// call retried without the tool (see withServerTools).
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 };

// How long a pre-session call may run. These are non-streaming and a web
// search round can take a while, but the SDK default of ten minutes (with
// retries) is not a timeout anyone waiting on a spinner would recognise.
const PLANNER_TIMEOUT_MS = 90_000;
// The agent's mid-turn lookup is silence the user sits through. It was 20 s
// wrapping a call allowed three searches over three rounds — which routinely
// could not finish in time, so the user got the full 20 s of silence AND no
// answer. Now one search, one round, and the request itself is aborted at
// the deadline (no SDK retries) rather than merely abandoned.
const RESEARCH_TIMEOUT_MS = 10_000;
// Server-side tool loops can return `pause_turn`; the caller continues by
// re-sending the conversation. A couple of rounds is plenty for max_uses 3.
const MAX_SERVER_TOOL_ROUNDS = 3;

interface ServerToolLimits {
  timeoutMs: number;
  maxRounds: number;
  maxSearches: number;
  maxRetries?: number;
}

const PLANNER_LIMITS: ServerToolLimits = {
  timeoutMs: PLANNER_TIMEOUT_MS,
  maxRounds: MAX_SERVER_TOOL_ROUNDS,
  maxSearches: 3,
};

const QUICK_RESEARCH_LIMITS: ServerToolLimits = {
  timeoutMs: RESEARCH_TIMEOUT_MS,
  maxRounds: 1,
  maxSearches: 1,
  maxRetries: 0,
};

/**
 * Everything the harness needs that it cannot get itself. Supplied by main.ts,
 * which owns the screen and the network; the agents package stays Electron-free
 * so the whole harness is unit-testable.
 */
export interface AgentRuntime {
  captureRegion: ToolDeps["captureRegion"];
  // Fires when the model starts a mid-turn tool, so the renderer can tell the
  // user a lookup is happening instead of sitting on a silent spinner.
  onToolStart?(tool: string, input: Record<string, unknown>): void;
  log(message: string): void;
}

export interface NextInstructionArgs {
  mode: AppMode;
  goal: string;
  completedSteps: string[];
  // The plan the agent reported last turn. Round-tripped so it can see its own
  // plan — without it, a plan_complete_step index refers to a list the model
  // is only guessing at.
  upcomingSteps?: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  followUp?: string;
  clarificationContext?: string;
  // Reference material the user attached (text/markdown files).
  uploadedContext?: string;
  // Notes the agent recorded on previous turns, oldest to newest.
  agentNotes?: string[];
  // Facts recalled from EARLIER sessions, already selected and formatted by
  // the memory ranker. Resolved once at session start so it stays byte-stable
  // across ticks rather than churning the prompt every turn.
  recalledMemory?: string;
  // Training mode: the active plan's context block (learner profile, module
  // outline, current task, mistake patterns). Re-resolved only when the plan
  // itself changes, so the header stays cache-friendly.
  trainingContext?: string;
  // Training mode: this task's previous check-my-work frame (data URL), sent
  // on a check turn so the coach can compare attempts.
  referenceFrame?: string;
  // The visible outcome the agent predicted for its last instruction —
  // round-tripped so it can verify the step happened before advancing.
  lastExpectedResult?: string;
  // Pacing context (tech_support): how long since the screen last changed
  // and since the assistant last spoke, plus whether the loop considers the
  // user stalled on the current step.
  secondsSinceScreenChange?: number;
  secondsSinceLastSpoke?: number;
  stalled?: boolean;
  // True on the very first look after the session starts — the model must
  // give the first step, not wait.
  sessionJustStarted?: boolean;
  // Whether the frame comparator saw a change since the last processed frame.
  // False means the history frame would be a duplicate, so it is dropped.
  screenChanged?: boolean;
}

// One client per key. Constructing a client per call is cheap but not free,
// and the key lookup behind it is a disk read — this runs every 3-15 s for
// the life of a session.
let cachedClient: { key: string; client: Anthropic } | null = null;

async function anthropicClient(): Promise<Anthropic> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new Anthropic({ apiKey }) };
  }
  return cachedClient.client;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `HTTP ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * One agent turn.
 *
 * The whole per-tick body now lives in the harness (electron/agents/harness/).
 * This function's job is the boundary work the harness deliberately does not
 * do: resolve the API key, pick the agent for the mode, wire the tool
 * dependencies that need Electron, and fold any plan edits into the result.
 *
 * The returned shape is unchanged from the pre-harness era, so every consumer
 * downstream — glow highlight, memory writes, the stall ladder's pace scaling
 * — keeps working untouched.
 */
export async function getNextInstruction(
  args: NextInstructionArgs,
  // Called with each completed sentence while the response is still
  // streaming, so TTS starts on sentence one instead of waiting for the whole
  // turn. Never fires when the agent calls `wait`.
  onSpeechChunk?: (chunk: SpeechChunk) => void,
  runtime?: AgentRuntime,
): Promise<InstructionResponse> {
  const client = await anthropicClient();
  const agent = getAgent(args.mode);
  const log = runtime?.log ?? (() => {});

  const deps: ToolDeps = {
    // Without a runtime the zoom tool degrades to "look at what you have"
    // rather than failing the turn — a missing capability must never take the
    // coach offline.
    captureRegion:
      runtime?.captureRegion ??
      (async () => null),
    // Bounded: the runner turns a throw into an is_error tool result, so a
    // hung search costs the agent one short wait, not the whole tick.
    research: (query) =>
      withDeadline(runQuickWebResearch(query), RESEARCH_TIMEOUT_MS, "research_timeout"),
    planDraft: newPlanDraft(),
    log,
  };

  const result = await runAgentTurn({
    client,
    model: MODEL,
    agent,
    ctx: { ...args, upcomingSteps: args.upcomingSteps ?? [] },
    deps,
    toContextResolution,
    onSpeechChunk,
    onToolStart: runtime?.onToolStart,
    log,
  });

  if (result.planEdits.length > 0) {
    const merged = applyPlanEdits(
      result.completedSteps,
      result.upcomingSteps,
      result.planEdits,
    );
    result.completedSteps = merged.completed;
    result.upcomingSteps = merged.upcoming;
    log(
      `[agent:${agent.id}] applied ${result.planEdits.length} plan edit(s) → ${merged.completed.length} done, ${merged.upcoming.length} upcoming`,
    );
  }

  // planEdits are internal bookkeeping — already applied above, and not
  // something the renderer should see or act on again.
  const { planEdits: _applied, ...response } = result;
  return response;
}

function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([p, deadline]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/**
 * The response's text, concatenated. Joined with nothing: a web-search-enabled
 * call returns its answer as several text blocks split at citation
 * boundaries, and joining them with newlines put raw line breaks inside JSON
 * string values — which failed to parse and silently produced an empty plan.
 */
function extractText(resp: Anthropic.Messages.Message): string {
  return resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function mediaTypeOf(dataUrl: string): ImageMediaType {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));/.exec(dataUrl);
  return (m?.[1] as ImageMediaType) ?? "image/png";
}

function screenshotBlocks(
  screenshot: string | undefined,
): Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> {
  if (!screenshot) return [];
  return [
    { type: "text", text: "Here's the user's current screen for context:" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaTypeOf(screenshot),
        data: stripDataUrlPrefix(screenshot),
      },
    },
  ];
}

/**
 * A non-streaming call that may use the server-side web_search tool.
 *
 * - `pause_turn` means the server's tool loop paused; the conversation so far
 *   is re-sent so it can continue. Treating it as a finished answer (the old
 *   behaviour) returned a half-written plan.
 * - If the API rejects the tool definition itself (a 400 — the account or
 *   model lacks it), the call is retried once without the tool. Any other
 *   error is rethrown: the SDK already retries transient failures, and
 *   re-issuing a rate-limited request without the tool just deepens the
 *   rate limit.
 */
async function withServerTools(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  label: string,
  limits: ServerToolLimits = PLANNER_LIMITS,
): Promise<Anthropic.Messages.Message> {
  const run = async (useWebSearch: boolean) => {
    const messages = [...params.messages];
    let last: Anthropic.Messages.Message | null = null;
    for (let round = 0; round < limits.maxRounds; round++) {
      const p: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        ...params,
        messages,
      };
      if (useWebSearch) {
        // The installed SDK's types predate server-side tools; the API
        // accepts them regardless.
        (p as { tools?: unknown }).tools = [
          { ...WEB_SEARCH_TOOL, max_uses: limits.maxSearches },
        ];
      }
      last = await client.messages.create(p, {
        timeout: limits.timeoutMs,
        ...(limits.maxRetries !== undefined ? { maxRetries: limits.maxRetries } : {}),
      });
      if ((last.stop_reason as string) !== "pause_turn") return last;
      logLine(`[claude:${label}] pause_turn — continuing the server tool loop`);
      messages.push({ role: "assistant", content: last.content });
    }
    return last!;
  };

  try {
    return await run(true);
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      logLine(
        `[claude:${label}] web search rejected (${describeError(err)}); retrying without it`,
      );
      return run(false);
    }
    throw err;
  }
}

export async function getClarifications(args: {
  mode: AppMode;
  goal: string;
}): Promise<ClarificationResponse> {
  const client = await anthropicClient();
  const agent = getAgent(args.mode);
  // Training's deeper intake earns more questions and the tokens to ask them.
  const limit = agent.maxClarifications ?? 3;
  try {
    const resp = await client.messages.create(
      {
        model: MODEL,
        // Five questions with four options each plus scaffolding ran past the
        // old 800-token cap often enough that the truncated JSON failed to
        // parse and the intake silently asked nothing.
        max_tokens: 1500,
        system: agent.clarificationPrompt,
        messages: [{ role: "user", content: `Task: ${args.goal}` }],
      },
      { timeout: PLANNER_TIMEOUT_MS },
    );
    if (resp.stop_reason === "max_tokens") {
      logLine("[claude:clarify] response hit max_tokens — questions may be truncated");
    }
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { questions?: unknown };
      if (Array.isArray(obj.questions)) {
        return {
          questions: obj.questions.slice(0, limit).map((q: unknown) => {
            if (typeof q === "object" && q !== null && "question" in q && "options" in q) {
              const typed = q as { question: string; options: unknown };
              return {
                question: String(typed.question),
                options: Array.isArray(typed.options) ? typed.options.map(String) : [],
              };
            }
            // Fallback for plain string questions (backwards compat)
            return { question: String(q), options: [] };
          }),
        };
      }
    }
    logLine(`[claude:clarify] no questions in response (${text.length} chars)`);
  } catch (err) {
    // Fail safe — never block session start — but never silently either: a
    // 401, a 429, and a parse failure all used to look like "nothing to ask".
    logLine(`[claude:clarify] FAILED: ${describeError(err)}`);
  }
  return { questions: [] };
}

export async function getSessionPlan(args: {
  mode: AppMode;
  goal: string;
  clarifications: Clarification[];
  // base64 data URL of the user's current screen, attached so the planner can
  // tailor steps to what's actually on screen. Optional.
  screenshot?: string;
}): Promise<SessionPlan> {
  const client = await anthropicClient();
  const clarText = args.clarifications
    .filter((c) => c.answer.trim())
    .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
    .join("\n");

  const userContent = [
    ...screenshotBlocks(args.screenshot),
    {
      type: "text" as const,
      text: `Goal: ${args.goal}${clarText ? `\n\nClarifications:\n${clarText}` : ""}`,
    },
  ];

  try {
    const resp = await withServerTools(
      client,
      {
        model: MODEL,
        max_tokens: 1500,
        system: getAgent(args.mode).planPrompt,
        messages: [{ role: "user", content: userContent }],
      },
      "plan",
    );
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { overview?: string; steps?: unknown };
      if (obj.overview && Array.isArray(obj.steps)) {
        return {
          overview: String(obj.overview).trim(),
          steps: obj.steps.slice(0, 6).map(String),
        };
      }
    }
    logLine(`[claude:plan] no plan in response (stop=${resp.stop_reason}, ${text.length} chars)`);
  } catch (err) {
    logLine(`[claude:plan] FAILED: ${describeError(err)}`);
  }
  return { overview: "", steps: [] };
}

/**
 * Training mode's pre-session call: the full curriculum OUTLINE — every
 * module's title, summary, and draft task titles, sized to the goal. The
 * modules are deliberately not detailed here; objectives and done-criteria
 * are written per module by detailTrainingModule, when that module is about
 * to start and the plan's journal shows how earlier ones actually went.
 *
 * Returns null on any failure — the UI keeps the user at the review step
 * rather than starting a session against an empty plan.
 */
export async function getCurriculumOutline(args: {
  goal: string;
  clarifications: Clarification[];
  screenshot?: string;
}): Promise<CurriculumOutline | null> {
  const client = await anthropicClient();
  const clarText = args.clarifications
    .filter((c) => c.answer.trim())
    .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
    .join("\n");

  const userContent = [
    ...screenshotBlocks(args.screenshot),
    {
      type: "text" as const,
      text: `Goal: ${args.goal}${clarText ? `\n\nIntake answers:\n${clarText}` : ""}`,
    },
  ];

  try {
    const resp = await withServerTools(
      client,
      {
        model: MODEL,
        max_tokens: 4000,
        system: getAgent("training").planPrompt,
        messages: [{ role: "user", content: userContent }],
      },
      "curriculum",
    );
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as {
        title?: unknown;
        overview?: unknown;
        learnerProfile?: unknown;
        modules?: unknown;
      };
      if (Array.isArray(obj.modules) && obj.modules.length > 0) {
        return {
          title: String(obj.title ?? "").trim(),
          overview: String(obj.overview ?? "").trim(),
          learnerProfile: String(obj.learnerProfile ?? "").trim(),
          modules: obj.modules.slice(0, 12).map((m) => {
            const mod = (m ?? {}) as {
              title?: unknown;
              summary?: unknown;
              taskTitles?: unknown;
            };
            return {
              title: String(mod.title ?? "").trim(),
              summary: String(mod.summary ?? "").trim(),
              taskTitles: Array.isArray(mod.taskTitles)
                ? mod.taskTitles.slice(0, 5).map(String)
                : [],
            };
          }),
        };
      }
    }
    logLine(
      `[claude:curriculum] no outline in response (stop=${resp.stop_reason}, ${text.length} chars)`,
    );
  } catch (err) {
    logLine(`[claude:curriculum] FAILED: ${describeError(err)}`);
  }
  return null;
}

/**
 * Write objectives and done-criteria for one module of an existing plan,
 * informed by the journal and mistake patterns — module 5 is written knowing
 * how modules 1-4 actually went. Returns null on failure; the caller retries
 * at the next session start.
 */
export async function detailTrainingModule(args: {
  plan: TrainingPlan;
  moduleIndex: number;
}): Promise<ModuleTaskDetail[] | null> {
  const client = await anthropicClient();
  const module = args.plan.modules[args.moduleIndex];
  if (!module) return null;

  const journal = args.plan.journal
    .slice(-10)
    .map((j) => `- ${j.note}`)
    .join("\n");
  const parts = [
    `Goal: ${args.plan.goal}`,
    args.plan.learnerProfile ? `Learner profile: ${args.plan.learnerProfile}` : "",
    outlineForPrompt(args.plan),
    args.plan.mistakePatterns.length > 0
      ? `Recurring mistake patterns:\n${args.plan.mistakePatterns.map((m) => `- ${m}`).join("\n")}`
      : "",
    journal ? `Journal of past sessions (oldest first):\n${journal}` : "",
    `Module to detail (module ${args.moduleIndex + 1}): "${module.title}" — ${module.summary}`,
    `Draft task titles:\n${module.tasks.map((t) => `- ${t.title}`).join("\n")}`,
  ].filter((p) => p.length > 0);

  try {
    const resp = await withServerTools(
      client,
      {
        model: MODEL,
        max_tokens: 3000,
        system: MODULE_DETAIL_PROMPT,
        messages: [{ role: "user", content: parts.join("\n\n") }],
      },
      "module-detail",
    );
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { tasks?: unknown };
      if (Array.isArray(obj.tasks) && obj.tasks.length > 0) {
        return obj.tasks.slice(0, 5).map((t) => {
          const task = (t ?? {}) as {
            title?: unknown;
            objective?: unknown;
            doneCriteria?: unknown;
          };
          return {
            title: String(task.title ?? "").trim(),
            objective: String(task.objective ?? "").trim(),
            doneCriteria: Array.isArray(task.doneCriteria)
              ? task.doneCriteria.map(String)
              : [],
          };
        });
      }
    }
    logLine(
      `[claude:module-detail] no tasks in response (stop=${resp.stop_reason}, ${text.length} chars)`,
    );
  } catch (err) {
    logLine(`[claude:module-detail] FAILED: ${describeError(err)}`);
  }
  return null;
}

// Mid-session research: real web search via the same server-side tool the
// session planner uses. Returns a tight factual summary the loop feeds back
// to the agent as context. Throws on failure — the caller (main.ts) falls
// back to the legacy DuckDuckGo instant-answer lookup.
const RESEARCH_SYSTEM_PROMPT = `You are the research arm of a live tech-support session. A coach is walking a non-expert user through a task on their computer and hit something it needs current facts for — often an exact error message or a product's current UI.

Search the web, then answer the query with a tight, factual summary under 250 words:
- Lead with the direct answer or the most likely fix.
- Use exact menu paths, button labels, and commands as they exist TODAY.
- If it's an error, list the top 1-3 causes with the fix for each, most likely first.
- Plain text only, no markdown headings, no preamble, no "based on my search".`;

export async function runWebResearch(query: string): Promise<string> {
  return research(query, PLANNER_LIMITS, 1024);
}

/**
 * The agent's mid-turn variant: one search, one round, hard 10 s abort. The
 * user is waiting in silence for this, so a thin answer now beats a thorough
 * one that never arrives.
 */
export async function runQuickWebResearch(query: string): Promise<string> {
  return research(query, QUICK_RESEARCH_LIMITS, 400);
}

async function research(
  query: string,
  limits: ServerToolLimits,
  maxTokens: number,
): Promise<string> {
  const client = await anthropicClient();
  const resp = await withServerTools(
    client,
    {
      model: MODEL,
      max_tokens: maxTokens,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
    },
    "research",
    limits,
  );
  const text = extractText(resp);
  if (!text) throw new Error("web research returned no text");
  return text;
}

export async function getGoalEvaluation(args: {
  mode: AppMode;
  goal: string;
  completedSteps: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
}): Promise<GoalEvaluation> {
  const client = await anthropicClient();

  const stepsSummary = args.completedSteps.length > 0
    ? `Completed steps: ${args.completedSteps.join(", ")}`
    : "No steps recorded yet.";

  const recentConvo = args.conversation
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "AI"}: ${t.content}`)
    .join("\n");

  const frameContent = args.frames.slice(-2).map((f) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaTypeOf(f.dataUrl),
      data: stripDataUrlPrefix(f.dataUrl),
    },
  }));

  const userContent = [
    ...frameContent,
    {
      type: "text" as const,
      text: `Goal: "${args.goal}"\n\n${stepsSummary}\n\nRecent conversation:\n${recentConvo}\n\nDid the user successfully complete their goal based on the screen and conversation? Return JSON: {"achieved": true/false, "verdict": "2-3 sentence honest but encouraging assessment"}`,
    },
  ];

  try {
    const resp = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 300,
        system: "You evaluate whether a user has completed their stated goal, based on screenshots and conversation history. Be honest, specific, and encouraging. Never invent progress that isn't visible.",
        messages: [{ role: "user", content: userContent }],
      },
      { timeout: PLANNER_TIMEOUT_MS },
    );
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { achieved?: boolean; verdict?: string };
      if (typeof obj.achieved === "boolean" && obj.verdict) {
        return { achieved: obj.achieved, verdict: String(obj.verdict).trim() };
      }
    }
    logLine(`[claude:evaluate] no verdict in response (${text.length} chars)`);
  } catch (err) {
    logLine(`[claude:evaluate] FAILED: ${describeError(err)}`);
  }
  return { achieved: false, verdict: "Couldn't evaluate at this time. Keep going — you're making progress!" };
}
