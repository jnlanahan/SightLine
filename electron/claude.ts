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
import type { ToolDeps } from "./agents/harness/types";
import type { MemorySearchHit } from "./memory-search";

// Re-exported so main.ts's error handling is unaffected by the harness move.
export { MissingApiKeyError, RateLimitError } from "./agents/harness/errors";
import { MissingApiKeyError } from "./agents/harness/errors";

const MODEL = "claude-sonnet-4-6";

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
    // Without a runtime there is nothing to search: an empty result, never a
    // failed turn.
    searchMemory: (query) =>
      runtime?.searchMemory
        ? runtime.searchMemory(query, args.chatId ?? null, args.recalledMemory ?? "")
        : Promise.resolve([]),
    log,
  };

  return runAgentTurn({
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
