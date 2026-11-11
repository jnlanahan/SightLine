import Anthropic from "@anthropic-ai/sdk";
import type {
  CaptureFrame,
  ConversationTurn,
  InstructionResponse,
  Stance,
} from "./types";
import { getKey } from "./credentials";
import { toContextResolution } from "./capture";
import { logLine } from "./log";
import type { SpeechChunk } from "./speech-chunker";
import { getAgent } from "./agents/registry";
import { runAgentTurn } from "./agents/harness/runner";
import { COACH_MODELS, FALLBACK_COACH_MODEL } from "./agents/harness/models";
import type { ToolDeps } from "./agents/harness/types";
import type { MemorySearchHit } from "./memory-search";
import type { ChatRecord, MemoryFact } from "./db/schema";
import {
  TIDY_SCHEMA,
  TIDY_SYSTEM,
  parseTidyProposal,
  tidyPrompt,
  type TidyProposal,
} from "./chat-tidy";
import {
  EMPTY_USAGE,
  addUsage,
  estimateCostUsd,
  normalizeUsage,
  type TokenUsage,
} from "./usage";

// Re-exported so main.ts's error handling is unaffected by the harness move.
export { MissingApiKeyError, RateLimitError } from "./agents/harness/errors";
import { MissingApiKeyError } from "./agents/harness/errors";

// What the coach runs on is the user's choice in Settings (Sonnet 5.5 or
// Opus 5.5), passed in with each look. How a look is asked of each model is
// in agents/harness/models.ts. This is the default when nothing is passed.
const MODEL = COACH_MODELS.sonnet;
// If this account cannot use a chosen model, the coach uses this one instead
// for the rest of the run rather than going dark. It is also what the
// mid-look web search runs on: a small, fixed job that should not change with
// the user's choice.
const FALLBACK_MODEL = FALLBACK_COACH_MODEL;
// Models this account has rejected during this run.
const rejectedModels = new Set<string>();

// Background work nobody is waiting on (the tidy-up after a chat is left).
// A small, cheap model is plenty for rewriting a summary and merging notes.
const BACKGROUND_MODEL = "claude-haiku-5-5";
const TIDY_TIMEOUT_MS = 60_000;

// Anthropic's server-side web search. The agent's mid-turn search_web tool is
// built on it. This is the variant with dynamic filtering, supported on
// Sonnet 4.6 and later; an account or model that rejects it gets the same
// call retried without the tool (see withServerTools).
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 };

// The agent's mid-turn lookup is silence the user sits through. It was 20 s
// wrapping a call allowed three searches over three rounds — which routinely
// could not finish in time, so the user got the full 20 s of silence AND no
// answer. Now one search, one round, and the request itself is aborted at
// the deadline (no SDK retries) rather than merely abandoned.
const RESEARCH_TIMEOUT_MS = 10_000;
interface ServerToolLimits {
  timeoutMs: number;
  maxRounds: number;
  maxSearches: number;
  maxRetries?: number;
}

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
  // The model id for the user's Settings choice. Absent = the default.
  model?: string;
  captureRegion: ToolDeps["captureRegion"];
  // Searches saved facts and earlier chats, leaving out the open chat and any
  // fact already in the recalled-memory block.
  searchMemory?(
    query: string,
    currentChatId: string | null,
    alreadyLoaded: string,
  ): Promise<MemorySearchHit[]>;
  // Fires when the model starts a mid-turn tool, so the renderer can tell the
  // user a lookup is happening instead of sitting on a silent spinner.
  onToolStart?(tool: string, input: Record<string, unknown>): void;
  log(message: string): void;
}

export interface NextInstructionArgs {
  goal: string;
  completedSteps: string[];
  // The plan the agent reported last turn, round-tripped so it can see its
  // own plan.
  upcomingSteps?: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  followUp?: string;
  // Reference material the user attached (text/markdown files).
  uploadedContext?: string;
  // Notes the agent recorded on previous turns, oldest to newest.
  agentNotes?: string[];
  // Facts recalled from EARLIER sessions, already selected and formatted by
  // the memory ranker. Resolved once at session start so it stays byte-stable
  // across ticks rather than churning the prompt every turn.
  recalledMemory?: string;
  // The visible outcome the agent predicted for its last instruction —
  // round-tripped so it can verify the step happened before advancing.
  lastExpectedResult?: string;
  // Pacing context: how long since the screen last changed
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
  // The coach's current stance (guide or watch), kept by the renderer and
  // shown to the coach in the context header each look.
  stance?: Stance;
  // A long goal's stages and the current one (0-based), kept by the renderer.
  stages?: string[];
  stageIndex?: number;
  // Set on the first look after a saved chat is reopened, so the coach greets
  // the user with where things stood instead of carrying on mid-thought.
  resuming?: { awayMinutes: number; whereWeLeftOff: string };
  // The open chat's id, so a search of earlier chats leaves this one out.
  chatId?: string | null;
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
 * do: resolve the API key, pick the agent, and wire the tool dependencies
 * that need Electron.
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
  const agent = getAgent();
  const log = runtime?.log ?? (() => {});

  // A web search inside a look is a model call of its own. It used to be
  // invisible to the cost meter and to the spending cap.
  let toolUsage: TokenUsage = { ...EMPTY_USAGE };

  const deps: ToolDeps = {
    // Without a runtime the zoom tool degrades to "look at what you have"
    // rather than failing the turn — a missing capability must never take the
    // coach offline.
    captureRegion:
      runtime?.captureRegion ??
      (async () => null),
    // Bounded: the runner turns a throw into an is_error tool result, so a
    // hung search costs the agent one short wait, not the whole tick.
    research: async (query) => {
      const found = await withDeadline(
        runQuickWebResearch(query),
        RESEARCH_TIMEOUT_MS,
        "research_timeout",
      );
      toolUsage = addUsage(toolUsage, found.usage);
      return found.text;
    },
    // Without a runtime there is nothing to search: an empty result, never a
    // failed turn.
    searchMemory: (query) =>
      runtime?.searchMemory
        ? runtime.searchMemory(query, args.chatId ?? null, args.recalledMemory ?? "")
        : Promise.resolve([]),
    log,
  };

  const turn = (model: string) =>
    runAgentTurn({
      client,
      model,
      agent,
      ctx: { ...args, upcomingSteps: args.upcomingSteps ?? [] },
      deps,
      toContextResolution,
      onSpeechChunk,
      onToolStart: runtime?.onToolStart,
      log,
    });

  const chosen = runtime?.model ?? MODEL;
  let coachModel = rejectedModels.has(chosen) ? FALLBACK_MODEL : chosen;
  let result;
  try {
    result = await turn(coachModel);
  } catch (err) {
    // The model id or the request shape was rejected outright — nothing was
    // streamed, so nothing was spoken. Try the fallback once, and stay on it
    // for this run: a coach on the previous model beats one that says nothing.
    const rejected =
      err instanceof Anthropic.NotFoundError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof Anthropic.BadRequestError;
    if (!rejected || coachModel === FALLBACK_MODEL) throw err;
    logLine(
      `[claude] ${coachModel} rejected the request (${describeError(err)}) — ` +
        `falling back to ${FALLBACK_MODEL} for the rest of this run`,
    );
    rejectedModels.add(coachModel);
    coachModel = FALLBACK_MODEL;
    result = await turn(coachModel);
  }

  if (toolUsage.inputTokens + toolUsage.outputTokens > 0) {
    result.usage = addUsage(result.usage ?? { ...EMPTY_USAGE }, toolUsage);
    result.costUsd = (result.costUsd ?? 0) + estimateCostUsd(FALLBACK_MODEL, toolUsage);
  }
  return result;
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
 * boundaries.
 */
function extractText(resp: Anthropic.Messages.Message): string {
  return resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * A non-streaming call that may use the server-side web_search tool.
 *
 * - `pause_turn` means the server's tool loop paused; the conversation so far
 *   is re-sent so it can continue. Treating it as a finished answer returned
 *   a half-written one.
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
  limits: ServerToolLimits,
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

// Mid-turn research: real web search via the server-side tool. Returns a
// tight factual summary handed back to the agent as the search_web result.
// Throws on failure; the runner turns that into an is_error tool result.
const RESEARCH_SYSTEM_PROMPT = `You are the research arm of a live tech-support session. A coach is walking a non-expert user through a task on their computer and hit something it needs current facts for — often an exact error message or a product's current UI.

Search the web, then answer the query with a tight, factual summary under 250 words:
- Lead with the direct answer or the most likely fix.
- Use exact menu paths, button labels, and commands as they exist TODAY.
- If it's an error, list the top 1-3 causes with the fix for each, most likely first.
- Plain text only, no markdown headings, no preamble, no "based on my search".`;

/**
 * The agent's mid-turn variant: one search, one round, hard 10 s abort. The
 * user is waiting in silence for this, so a thin answer now beats a thorough
 * one that never arrives.
 */
export async function runQuickWebResearch(
  query: string,
): Promise<{ text: string; usage: TokenUsage }> {
  return research(query, QUICK_RESEARCH_LIMITS, 400);
}

async function research(
  query: string,
  limits: ServerToolLimits,
  maxTokens: number,
): Promise<{ text: string; usage: TokenUsage }> {
  const client = await anthropicClient();
  const resp = await withServerTools(
    client,
    {
      // A fixed model, not the user's choice: this is a small lookup with a
      // 10 s deadline, and this model lets thinking be switched off outright.
      model: FALLBACK_MODEL,
      max_tokens: maxTokens,
      // Off on purpose. An omitted `thinking` means thinking is ON, and it
      // would eat this small token allowance and the 10 s the user is
      // waiting through.
      thinking: { type: "disabled" },
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
    },
    "research",
    limits,
  );
  const text = extractText(resp);
  if (!text) throw new Error("web research returned no text");
  return { text, usage: normalizeUsage(resp.usage) };
}

export interface TidyCallResult {
  /** Null when the model declined, ran out of room, or answered off-shape. */
  proposal: TidyProposal | null;
  usage: TokenUsage;
  model: string;
  costUsd: number;
}

/**
 * The background tidy-up of a chat the user has left: one non-streamed call
 * that proposes a title, a summary, note merges and durable facts. It only
 * proposes — chat-tidy.ts decides what is actually written.
 *
 * Structured output keeps the answer parseable; if the small model is not
 * available to this account, the coach's own model is tried once instead.
 */
export async function tidyChat(
  record: ChatRecord,
  facts: readonly MemoryFact[],
): Promise<TidyCallResult> {
  const client = await anthropicClient();
  const run = (model: string) =>
    client.messages.create(
      {
        model,
        // Room for the small model's own reasoning as well as the answer.
        max_tokens: 8000,
        system: TIDY_SYSTEM,
        messages: [{ role: "user", content: tidyPrompt(record, facts) }],
        output_config: {
          format: { type: "json_schema", schema: { ...TIDY_SCHEMA } },
        },
      },
      { timeout: TIDY_TIMEOUT_MS, maxRetries: 1 },
    );

  let model = BACKGROUND_MODEL;
  let resp: Anthropic.Messages.Message;
  try {
    resp = await run(model);
  } catch (err) {
    if (
      err instanceof Anthropic.NotFoundError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof Anthropic.BadRequestError
    ) {
      logLine(
        `[claude:tidy] ${model} rejected (${describeError(err)}); retrying on ${FALLBACK_MODEL}`,
      );
      model = FALLBACK_MODEL;
      resp = await run(model);
    } else {
      throw err;
    }
  }

  const usage = normalizeUsage(resp.usage);
  const costUsd = estimateCostUsd(model, usage);
  const stop = resp.stop_reason as string | null;
  if (stop === "refusal" || stop === "max_tokens") {
    logLine(`[claude:tidy] no usable answer (stop=${stop})`);
    return { proposal: null, usage, model, costUsd };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(extractText(resp));
  } catch {
    logLine("[claude:tidy] answer was not JSON");
  }
  return { proposal: parseTidyProposal(parsed), usage, model, costUsd };
}
