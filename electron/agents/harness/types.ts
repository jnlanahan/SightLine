// The agent harness contract.
//
// Three things every agent owns, and one thing it does not:
//
//   skills  — composable units of behaviour. A skill contributes prompt text,
//             tools, per-turn context, and fields on the terminal tool. Skills
//             are shared freely between agents (see ../skills/).
//   tools   — what the model can actually DO mid-turn, beyond speaking.
//   loop    — when this agent wants to look at the screen (LoopPolicy), plus
//             an optional shouldTick() for behaviour a policy can't express.
//
// What an agent does NOT own is the loop *executor*. Ticking needs the frame
// hash, the TTS queue, and the session store, all of which live in the
// renderer — so the agent declares the policy and the renderer runs it. That
// split is deliberate: the scheduler is infrastructure, the cadence is the
// agent's. See src/hooks/useSessionLoop.ts.
//
// Pure module — no Electron imports, so the whole harness is unit-testable.

import type {
  AppMode,
  CaptureFrame,
  ConversationTurn,
  HighlightRect,
  LoopPolicy,
} from "../../types";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** What a tool hands back to the model. Text, an image, or both. */
export interface ToolOutput {
  text?: string;
  // base64 data URL — returned to the model as an image block in the
  // tool_result, which is how read_screen_region shows it a sharper crop.
  imageDataUrl?: string;
  isError?: boolean;
}

/**
 * Everything a tool is allowed to touch. Injected by the caller (main.ts) so
 * this module stays Electron-free and tools stay testable with fakes.
 */
export interface ToolDeps {
  /** Re-capture the watched screen, cropped to a fraction of the last frame. */
  captureRegion(rect: HighlightRect): Promise<CaptureFrame | null>;
  /** Live web lookup. Throws on failure; the runner turns that into is_error. */
  research(query: string): Promise<string>;
  /** Plan mutations the agent requested this turn, applied after the turn. */
  planDraft: PlanDraft;
  log(message: string): void;
}

/**
 * A tool the model may call mid-turn. Distinct from the terminal say/wait
 * tools, which end the turn and are assembled from skill output fields.
 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the input. Must be a stable literal — see TOOLS below. */
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>, deps: ToolDeps): Promise<ToolOutput>;
}

// ---------------------------------------------------------------------------
// Plan mutation (the seam the Training agent grows into)
// ---------------------------------------------------------------------------

export type PlanEdit =
  | { op: "add"; description: string; after?: number }
  | { op: "revise"; index: number; description: string }
  | { op: "complete"; index: number };

/** Per-turn accumulator. The runner hands the applied result to the caller. */
export interface PlanDraft {
  edits: PlanEdit[];
}

export function newPlanDraft(): PlanDraft {
  return { edits: [] };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * One field a skill owns on the terminal tools.
 *
 * `on` decides which terminal tools carry it. "both" means the field also
 * appears on `wait` — that is how a silent turn can still record progress,
 * which the loop has always relied on ("these apply on EVERY action,
 * including wait, so Claude can mark progress silently").
 */
export interface OutputField {
  name: string;
  schema: Record<string, unknown>;
  on: "say" | "both";
  required?: boolean;
}

/** Read-only view of the turn, passed to context builders. */
export interface TurnContext {
  mode: AppMode;
  goal: string;
  completedSteps: string[];
  upcomingSteps: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  followUp?: string;
  clarificationContext?: string;
  uploadedContext?: string;
  agentNotes?: string[];
  recalledMemory?: string;
  // Training mode: the plan block (learner profile, outline, current task,
  // mistake patterns, where-we-left-off). Resolved when the plan changes, not
  // per tick, so the header stays cache-friendly.
  trainingContext?: string;
  // Training mode: the frame stored at this task's previous check-my-work,
  // attached on a check turn so the coach can compare attempts.
  referenceFrame?: string;
  lastExpectedResult?: string;
  secondsSinceScreenChange?: number;
  secondsSinceLastSpoke?: number;
  stalled?: boolean;
  sessionJustStarted?: boolean;
  screenChanged?: boolean;
}

/**
 * A composable unit of agent behaviour.
 *
 * Every slot is optional, so a skill can be pure prompt text (socratic), pure
 * tooling (screenReading), or all five (research: prompt + tool + context +
 * fields). Sharing a skill between agents is just listing it twice.
 */
export interface Skill {
  id: string;
  /** Prompt text, appended to the system prompt in skill order. */
  systemFragment?: string;
  /** Tools this skill contributes. See TOOL ORDER below. */
  tools?: AgentTool[];
  /** Per-turn context blocks, appended to the user message. */
  contextBlocks?: (ctx: TurnContext) => string[];
  /** Fields this skill owns on the terminal say/wait tools. */
  outputFields?: OutputField[];
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** Guidance appended to the context header when the loop signals a situation. */
export interface AgentGuidance {
  stalled: string;
  sessionStart: string;
  followUp: string;
}

export interface Agent {
  id: AppMode;
  /** The persona. First block of the system prompt, before any skill text. */
  intro: string;
  /**
   * Skills, in prompt order. This array is the single source of truth for the
   * agent's tools, output schema, and context blocks.
   *
   * TOOL ORDER IS LOAD-BEARING. Tool definitions render ahead of the system
   * prompt in the request, so reordering or conditionally including a tool
   * invalidates the entire prompt cache for every later tick. Keep this list
   * a fixed literal per agent; never build it from runtime state.
   * Locked by src/__tests__/agentHarness.test.ts.
   */
  skills: Skill[];
  /** When this agent wants to be ticked. Executed by the renderer. */
  loop: LoopPolicy;
  /**
   * How many times the model may call a mid-turn tool before the harness
   * forces it to finish. Each iteration is a round trip the user waits
   * through, so this is a latency budget, not just a safety valve.
   */
  maxToolIterations: number;
  /** Closing instruction on every turn. */
  nextTurnPrompt: string;
  /**
   * When a `wait` records a newly completed step, hand it back once and ask
   * for speech instead. The user just did what the coach asked and is waiting
   * to hear what's next — a silent turn there reads as the coach having
   * stopped watching, and the loop's screen-change gate then keeps it silent
   * until they move. Off for agents whose silent turns are the point
   * (training's activity log).
   */
  speakOnStepComplete?: boolean;
  guidance: AgentGuidance;
  /** Pre-session prompts. Not part of the per-tick loop. */
  clarificationPrompt: string;
  planPrompt: string;
  /** How many intake questions the pre-session call may keep. Default 3. */
  maxClarifications?: number;
}

// ---------------------------------------------------------------------------
// Terminal tool names
// ---------------------------------------------------------------------------

/**
 * The two tools that end a turn. Every agent has both.
 *
 * Splitting silence into its own tool is what makes the speech gate exact: the
 * tool name arrives in `content_block_start`, before a single character of
 * instruction text streams, so a silent turn is known silent with nothing to
 * buffer and nothing to retract.
 */
export const SAY_TOOL = "say";
export const WAIT_TOOL = "wait";

export type TerminalToolName = typeof SAY_TOOL | typeof WAIT_TOOL;
