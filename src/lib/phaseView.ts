// The phase-chat screen's view model (docs/redesign/DATA.md).
//
// The coach already produces everything the redesigned screen shows: stages,
// the step log, the instruction in flight, the next few steps and the
// transcript. This module turns that state into phases → steps → messages,
// once, so components only render. Pure and unit-tested
// (src/__tests__/phaseView.test.ts); it builds on toPlanSteps rather than
// stitching the plan a second time.
//
// Code word "stage", UI word "Phase" (redesign D3).

import type { StepLogEntry } from "../../electron/db/schema";
import type { ConversationTurn } from "../../electron/types";
import { toPlanSteps } from "./planSteps";

export type Layout = "quick" | "single" | "phased";
export type ItemState = "done" | "current" | "upcoming";

export interface StepVM {
  /** Global, 1-based, counted across the whole chat. */
  n: number;
  /** Done: the log's phrase. Current: the phrase planned for it, or "" (label
   *  reads "Step n" alone). Upcoming: the coach's phrase (rail dots only). */
  title: string;
  state: ItemState;
  /** Added to the plan this sitting (DATA.md §4). */
  added: boolean;
  /** Messages under this step, oldest first. Empty for upcoming steps. */
  turns: ConversationTurn[];
  /** True only for the current step: it holds the one lead line. */
  isLeadHolder: boolean;
  /** Index in `turns` of the coach turn shown as the lead line (and so hidden
   *  from the body list), or null when none matches. Current step only. */
  leadIndex: number | null;
}

export interface PhaseVM {
  title: string;
  state: ItemState;
  /** Empty for upcoming phases: the coach writes a stage's steps only when the
   *  user reaches it. */
  steps: StepVM[];
}

export interface PhaseView {
  layout: Layout;
  /** "single" and "quick": exactly one phase, with an empty title. */
  phases: PhaseVM[];
  /** Index into phases; phases.length when the goal is reached. */
  currentPhase: number;
  /** Global number of the step in progress (when done: the last step). */
  currentStep: number;
  /** The header's "step k of K", counted within the current phase. */
  stepInPhase: { k: number; K: number };
  done: boolean;
}

/** The slice of session state this module reads. */
export interface PhaseInput {
  stages: readonly string[];
  stageIndex: number;
  stepLog: readonly StepLogEntry[];
  currentInstruction: string;
  upcomingSteps: readonly string[];
  conversation: readonly ConversationTurn[];
  done: boolean;
}

export interface PhaseViewOptions {
  /** The current step's planned phrase (see `trackCurrentTitle`). */
  currentTitle?: string;
  /** Step phrases added this sitting, as returned by `diffPlan`. */
  addedSteps?: ReadonlySet<string>;
  /** The most structured layout seen this sitting (see `stickyLayout`). */
  layoutFloor?: Layout;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ── §2 Which layout ──

export function layoutOf(
  s: Pick<PhaseInput, "stages" | "stepLog" | "currentInstruction" | "done" | "upcomingSteps">,
): Layout {
  if (s.stages.length >= 2) return "phased";
  const known =
    s.stepLog.length +
    (s.currentInstruction.trim() && !s.done ? 1 : 0) +
    s.upcomingSteps.length;
  return known >= 2 ? "single" : "quick";
}

/**
 * Sticky within a sitting: once a chat has had a plan it never drops back to
 * "quick", even when the upcoming list empties near the end. The floor lives
 * in component state and is not saved; a reopened chat recomputes.
 */
export function stickyLayout(computed: Layout, floor: Layout | undefined): Layout {
  if (computed === "quick" && floor && floor !== "quick") return floor;
  return computed;
}

// ── §3.1 Done steps → phases ──

/**
 * The phase index of each step-log entry. Walks the log in order: an entry
 * whose stage matches a stage title moves the phase there; a missing or
 * unmatched stage (an older chat, a renamed stage) stays in the phase before.
 */
export function assignStepPhases(
  stepLog: readonly StepLogEntry[],
  stages: readonly string[],
): number[] {
  let p = 0;
  return stepLog.map((entry) => {
    if (entry.stage) {
      const i = stages.indexOf(entry.stage);
      if (i >= 0) p = i;
    }
    return p;
  });
}

// ── §3.2 The current step's title ──

export interface TitleTrack {
  /** Step-log length when last seen. */
  stepCount: number;
  /** The upcoming list when last seen. */
  upcoming: readonly string[];
  /** The current step's title so far ("" when unknown). */
  title: string;
}

/**
 * Keep the current step's planned phrase. When steps finish, the new current
 * step is the first phrase the coach had queued that was not itself just
 * finished. Otherwise the title is unchanged. Starts as "" — the label then
 * reads "Step n" alone; the lead line already says the instruction in full.
 */
export function trackCurrentTitle(
  prev: TitleTrack,
  next: { stepLog: readonly StepLogEntry[]; upcomingSteps: readonly string[] },
): TitleTrack {
  const stepCount = next.stepLog.length;
  let title = prev.title;
  if (stepCount > prev.stepCount) {
    const finished = new Set(next.stepLog.slice(prev.stepCount).map((e) => norm(e.text)));
    title = prev.upcoming.find((u) => u.trim() && !finished.has(norm(u)))?.trim() ?? "";
  } else if (stepCount < prev.stepCount) {
    // A different chat was loaded.
    title = "";
  }
  return { stepCount, upcoming: [...next.upcomingSteps], title };
}

// ── §4 Plan changes ──

export interface PlanSnapshot {
  upcomingSteps: readonly string[];
  stages: readonly string[];
}

export interface PlanDiff {
  /** Step phrases inserted into the plan (not tail growth). */
  added: string[];
  /** Step phrases taken out of the plan (not completed). */
  removed: string[];
  addedPhases: string[];
  removedPhases: string[];
  /** One line per change, in the SPEC §10 wording. */
  notes: string[];
}

/**
 * Compare the plan before and after one coach turn. The coach shares only the
 * next 2 to 4 steps, so a window that slides forward (new phrases at the
 * tail, finished ones off the front, the last one pushed out by an insertion)
 * is progress, not a change. Plain progress makes no note.
 */
export function diffPlan(
  prev: PlanSnapshot,
  next: PlanSnapshot,
  newlyCompleted: readonly string[],
  // How many steps BEGAN this turn. The coach's list holds what comes after
  // the step in progress, so when a step begins, the phrase queued at the
  // front of the list leaves it — it is now the current step, not a removal.
  // Without this, nearly every new step drew a false "Plan updated: removed"
  // note (seen driving the real screen, 11 November 2026).
  started = 0,
): PlanDiff {
  const completed = new Set(newlyCompleted.map(norm));
  const prevList = prev.upcomingSteps.map((s) => s.trim()).filter(Boolean);
  const nextList = next.upcomingSteps.map((s) => s.trim()).filter(Boolean);
  const prevSet = new Set(prevList.map(norm));
  const nextSet = new Set(nextList.map(norm));

  const added: string[] = [];
  const removed: string[] = [];

  // An empty list after a non-empty one says nothing about the plan (a turn
  // that leaves the list out keeps the plan), so it is never a change.
  if (nextList.length > 0) {
    // What was still ahead after this turn's finished steps came off, and
    // after the steps that began this turn came off the front. Only phrases
    // that really left the list count as begun: if the coach started a step
    // it had not queued, the queue is untouched.
    const afterFinished = prevList.filter((s) => !completed.has(norm(s)));
    let begun = 0;
    while (begun < started && begun < afterFinished.length && !nextSet.has(norm(afterFinished[begun]))) {
      begun++;
    }
    const stillAhead = afterFinished.slice(begun);
    nextList.forEach((s, i) => {
      const k = norm(s);
      if (!prevSet.has(k) && !completed.has(k) && i < stillAhead.length) added.push(s);
    });
    stillAhead.forEach((s, i) => {
      if (nextSet.has(norm(s))) return;
      // Pushed off the end by an insertion: every later phrase is gone too.
      // The window is 2 to 4 phrases, so what falls off the tail when a step
      // is put in is still ahead, just out of view. Not a removal.
      const restGone = stillAhead.slice(i + 1).every((r) => !nextSet.has(norm(r)));
      if (restGone && added.length > 0) return;
      removed.push(s);
    });
  }

  // Phases. The first plan arriving is the layout switch's note, not a change.
  const addedPhases: string[] = [];
  const removedPhases: string[] = [];
  if (prev.stages.length > 0 && next.stages.length > 0) {
    const ps = new Set(prev.stages.map(norm));
    const ns = new Set(next.stages.map(norm));
    for (const t of next.stages) if (!ps.has(norm(t))) addedPhases.push(t);
    for (const t of prev.stages) if (!ns.has(norm(t))) removedPhases.push(t);
  }

  const notes: string[] = [];
  if (added.length > 0 && removed.length > 0) {
    notes.push(`Plan updated: ${Math.max(added.length, removed.length)} steps changed`);
  } else {
    for (const s of added) notes.push(`Plan updated: added "${s}"`);
    for (const s of removed) notes.push(`Plan updated: removed "${s}"`);
  }
  for (const t of addedPhases) notes.push(`Plan updated: added phase "${t}"`);
  for (const t of removedPhases) notes.push(`Plan updated: removed phase "${t}"`);

  return { added, removed, addedPhases, removedPhases, notes };
}

// ── §5 Messages → steps ──

/**
 * Put each turn under a step. Returns one list per step number, indexed by
 * `n - 1`, for steps 1..lastStep.
 *
 * Tagged turns use their `step` tag. Turns from chats saved before tagging go
 * by time: under the first logged step finished at or after the turn, or the
 * current step when it came after the last one.
 */
export function groupTurns(
  conversation: readonly ConversationTurn[],
  stepLog: readonly StepLogEntry[],
  lastStep: number,
): ConversationTurn[][] {
  const count = Math.max(1, lastStep);
  const buckets: ConversationTurn[][] = Array.from({ length: count }, () => []);
  for (const turn of conversation) {
    let n: number;
    if (typeof turn.step === "number" && Number.isFinite(turn.step)) {
      n = turn.step;
    } else {
      const i = stepLog.findIndex((e) => e.at >= turn.timestamp);
      n = i >= 0 ? i + 1 : stepLog.length + 1;
    }
    n = Math.min(Math.max(Math.round(n), 1), count);
    buckets[n - 1].push(turn);
  }
  return buckets;
}

/** The newest coach turn that says the current instruction, or null. */
function leadIndexOf(turns: readonly ConversationTurn[], instruction: string): number | null {
  const target = instruction.trim();
  if (!target) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "assistant" && turns[i].content.trim() === target) return i;
  }
  return null;
}

// ── §3 Building the view ──

export function buildPhaseView(input: PhaseInput, opts: PhaseViewOptions = {}): PhaseView {
  const layout = stickyLayout(layoutOf(input), opts.layoutFloor);
  const added = new Set([...(opts.addedSteps ?? [])].map(norm));
  const log = input.stepLog.filter((e) => e.text.trim().length > 0);

  // Phase titles.
  const titles = layout === "phased" ? [...input.stages] : [""];
  const phaseCount = titles.length;
  const live = layout === "phased" ? Math.min(Math.max(input.stageIndex, 0), phaseCount - 1) : 0;
  const currentPhase = input.done ? phaseCount : live;

  // The ordered plan, stitched once. Its upcoming entries are already
  // de-duplicated against the finished ones.
  const plan = toPlanSteps({
    completedSteps: log.map((e) => e.text),
    currentInstruction: input.currentInstruction,
    upcomingSteps: [...input.upcomingSteps],
    done: input.done,
  });
  const upcoming = plan.filter((p) => p.state === "upcoming").map((p) => p.description);

  const doneCount = log.length;
  const hasCurrent = !input.done;
  const currentStep = hasCurrent ? doneCount + 1 : Math.max(doneCount, 1);
  const lastWithTurns = hasCurrent ? doneCount + 1 : Math.max(doneCount, 1);
  const buckets = groupTurns(input.conversation, log, lastWithTurns);

  // Done steps, each in its phase (single/quick: all in phase 0).
  const stepPhase = layout === "phased" ? assignStepPhases(log, titles) : log.map(() => 0);
  // A step logged against a phase later than the live one (a stage the coach
  // later moved back from) is shown in the live phase rather than lost.
  const phaseOfDone = stepPhase.map((p) => (input.done ? p : Math.min(p, live)));

  const phases: PhaseVM[] = titles.map((title, i) => ({
    title,
    state: i < currentPhase ? "done" : i === currentPhase ? "current" : "upcoming",
    steps: [],
  }));

  log.forEach((entry, i) => {
    phases[phaseOfDone[i]].steps.push({
      n: i + 1,
      title: entry.text.trim(),
      state: "done",
      added: added.has(norm(entry.text)),
      turns: buckets[i] ?? [],
      isLeadHolder: false,
      leadIndex: null,
    });
  });

  if (hasCurrent) {
    const turns = buckets[doneCount] ?? [];
    const title = (opts.currentTitle ?? "").trim();
    phases[live].steps.push({
      n: doneCount + 1,
      title,
      state: "current",
      added: title ? added.has(norm(title)) : false,
      turns,
      isLeadHolder: true,
      leadIndex: leadIndexOf(turns, input.currentInstruction),
    });
    upcoming.forEach((t, j) => {
      phases[live].steps.push({
        n: doneCount + 2 + j,
        title: t,
        state: "upcoming",
        added: added.has(norm(t)),
        turns: [],
        isLeadHolder: false,
        leadIndex: null,
      });
    });
  } else if (doneCount === 0 && input.conversation.length > 0) {
    // A finished quick answer with no logged step still needs a home for its
    // messages.
    phases[phaseCount - 1].steps.push({
      n: 1,
      title: "",
      state: "done",
      added: false,
      turns: buckets[0] ?? [],
      isLeadHolder: false,
      leadIndex: null,
    });
  }

  // Header counts, within the current phase.
  let stepInPhase: { k: number; K: number };
  if (hasCurrent) {
    const doneHere = phases[live].steps.filter((s) => s.state === "done").length;
    const k = doneHere + 1;
    stepInPhase = { k, K: k + upcoming.length };
  } else {
    const lastPhase = phases[phaseCount - 1];
    const n = lastPhase.steps.length;
    stepInPhase = { k: n, K: n };
  }

  return { layout, phases, currentPhase, currentStep, stepInPhase, done: input.done };
}

// ── Wording helpers (SPEC §6.5, §6.6, §10) ──

/** The resume divider: "Picked up where you left off · 2 days ago". */
export function resumeDividerText(awayMinutes: number): string {
  const m = Math.max(1, Math.round(Number.isFinite(awayMinutes) ? awayMinutes : 1));
  let ago: string;
  if (m < 60) ago = `${m} minute${m === 1 ? "" : "s"}`;
  else if (m < 48 * 60) {
    const h = Math.round(m / 60);
    ago = `${h} hour${h === 1 ? "" : "s"}`;
  } else {
    const d = Math.round(m / (24 * 60));
    ago = `${d} day${d === 1 ? "" : "s"}`;
  }
  return `Picked up where you left off · ${ago} ago`;
}

/** The goal-reached headline: the coach's last line if it is short, else "Done." */
export function completionHeadline(lastCoachLine: string | undefined): string {
  const line = (lastCoachLine ?? "").trim();
  return line && line.length < 60 ? line : "Done.";
}

export const COMPLETION_BODY =
  "This chat stays open. Ask anything about it later and I'll pick up from here.";

/** The goal turn the app records first ("Goal: …"), or null. */
export function goalTurnText(turn: ConversationTurn): string | null {
  return turn.role === "user" && turn.content.startsWith("Goal:")
    ? turn.content.slice("Goal:".length).trim()
    : null;
}

// ── §7 Coach states ──

export interface CoachStateInput {
  status: "idle" | "watching" | "thinking" | "waiting" | "paused" | "error";
  activeTool: string | null;
  /** The newest turn in the conversation, if any. */
  newest: Pick<ConversationTurn, "role" | "content"> | undefined;
  goalPending: boolean;
  done: boolean;
  listening: boolean;
  troubleshooting: boolean;
  needsYou: boolean;
  /** The words the "I did it" reply sends (quickReplies.STEP_DONE_REPLY). */
  stepDoneReply: string;
}

export interface CoachState {
  /** Header and section state word. */
  word: string;
  /** The footer's status row while the coach looks after the user asked
   *  something; null shows the one-tap replies. */
  statusRow: string | null;
  /** The rail halo: breathing while it watches, off when it is not looking,
   *  none once the goal is reached. */
  halo: "breathing" | "off" | "none";
}

const TOOL_WORDS: Record<string, string> = {
  read_screen_region: "Taking a closer look",
  search_web: "Looking that up",
  search_memory: "Checking earlier chats",
};

/**
 * The state words of SPEC §7, plus the three the plan adds (fixing a problem,
 * checking earlier chats, waiting on the goal). `pendingFollowUp` is cleared
 * the moment a look starts, so "looking because you asked" is read from the
 * conversation: while thinking, a newest turn from the user means the coach
 * is answering them. A routine look still says "Watching" — it must not
 * promise speech.
 */
export function coachState(s: CoachStateInput): CoachState {
  if (s.done && s.status !== "thinking") return { word: "Done", statusRow: null, halo: "none" };
  if (s.needsYou) return { word: "Needs you", statusRow: null, halo: "off" };
  if (s.status === "paused") return { word: "Paused", statusRow: null, halo: "off" };
  if (s.listening) return { word: "Listening", statusRow: null, halo: "breathing" };
  if (s.status === "thinking") {
    const tool = s.activeTool ? TOOL_WORDS[s.activeTool] ?? TOOL_WORDS.read_screen_region : null;
    if (tool) return { word: tool, statusRow: tool, halo: "breathing" };
    if (s.newest?.role === "user") {
      return s.newest.content === s.stepDoneReply
        ? { word: "Checking", statusRow: "Checking your screen", halo: "breathing" }
        : { word: "Looking", statusRow: "Looking at your screen", halo: "breathing" };
    }
  }
  if (s.goalPending && s.status !== "thinking") return { word: "Waiting for you", statusRow: null, halo: "off" };
  if (s.troubleshooting && (s.status === "watching" || s.status === "thinking")) {
    return { word: "Fixing a problem", statusRow: null, halo: "breathing" };
  }
  return { word: "Watching", statusRow: null, halo: "breathing" };
}

// ── §7 Needs you ──

export type NeedsYouAction = "key" | "cap" | "screen" | "retry";

export interface NeedsYou {
  message: string;
  action: NeedsYouAction | null;
  /** The raw error, for a tooltip and the log — never the main words. */
  detail?: string;
}

export const NEEDS_YOU_ACTION_LABEL: Record<NeedsYouAction, string> = {
  key: "Add a key",
  cap: "Raise the cap",
  screen: "Pick the screen",
  retry: "Try again",
};

/**
 * What needs the user, in plain words (SPEC §10), from the state the loop
 * already keeps. The loop's own error strings are technical and stay as they
 * are (they are logged); this only decides what the screen says.
 */
export function needsYouOf(s: {
  status: CoachStateInput["status"];
  error: string | null;
  hasKey: boolean;
  capReached: boolean;
  rateLimitSeconds: number | null;
}): NeedsYou | null {
  const err = s.error ?? "";
  if (!s.hasKey || err.startsWith("No Anthropic API key")) {
    return {
      message: "No AI key yet. Add one to start. It goes in SightLine's .env file; restart after adding it.",
      action: "key",
    };
  }
  if (s.capReached) {
    return { message: "You've reached your spending cap for this sitting.", action: "cap" };
  }
  // Repeated capture failure stops the loop with status "error"; a single
  // failed grab just retries, and reads as the generic wait below.
  if (s.status === "error") {
    return { message: "I can't see the screen you picked.", action: "screen", detail: err || undefined };
  }
  if (s.rateLimitSeconds !== null) {
    return err.startsWith("Rate limited") || !err
      ? { message: `The AI service asked us to wait. Trying again in ${s.rateLimitSeconds}s.`, action: null }
      : { message: `Something went wrong. Trying again in ${s.rateLimitSeconds}s.`, action: null, detail: err };
  }
  if (err) return { message: "Something went wrong.", action: "retry", detail: err };
  return null;
}
