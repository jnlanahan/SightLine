import { create } from "zustand";
import { EMPTY_USAGE, addUsage } from "../../electron/usage";
import {
  appendToStepLog,
  clampStage,
  type RestoredSession,
} from "../../electron/chat-record";
import { addNote, editNote, forgetNote, newNoteId } from "../../electron/chat-notes";
import type { ChatNote, ChatTidy } from "../../electron/db/schema";
import type {
  CaptureFrame,
  ConversationTurn,
  SessionStatus,
  Stance,
  StepLogEntry,
  StepPace,
  TokenUsage,
  UploadedContext,
} from "../lib/api";

export interface SessionState {
  status: SessionStatus;
  goal: string | null;
  // The goal as the coach said it back, and what done will look like. Empty
  // until the coach proposes one (a quick question never gets one).
  agreedGoal: string;
  doneWhen: string;
  // The coach has said the goal back and the user has not answered yet. The
  // loop holds its looks while this is true: a step nobody agreed to is the
  // thing this exists to prevent.
  goalPending: boolean;
  currentInstruction: string;
  // Copyable code/command text that came with the current instruction.
  currentCode: string;
  // The mid-turn tool the agent is running right now (web search, zoomed
  // read), so the UI can say "Looking that up…" instead of a bare spinner.
  activeTool: { name: string; detail: string } | null;
  completedSteps: string[];
  // The audit trail behind completedSteps: each finished step with the time
  // it was done. Append-only, saved with the chat, and what the user scrolls
  // back through to see exactly what was done.
  stepLog: StepLogEntry[];
  upcomingSteps: string[];
  diverted: boolean;
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  lastError: string | null;
  rateLimitUntil: number | null;
  done: boolean;

  // User-attached reference material (text/markdown), in-session only.
  uploadedContext: string;
  attachedFileNames: string[];
  // The chat's notes, oldest to newest — live and retired. Only live ones
  // are shown to the coach and the user (chat-notes.ts → liveNotes). The
  // live session is the one copy autosave writes from, so the user's edits
  // and forgets are made here, never to the saved file behind its back.
  agentNotes: ChatNote[];
  lastProcessedHash: string | null;
  pendingFollowUp: string | null;

  // Used to avoid speaking / re-rendering the same instruction back-to-back.
  lastSpokenInstruction: string | null;
  // Time the assistant last spoke (any spoken action), used for pacing.
  lastSpokeAt: number | null;
  // Time the last Claude call was made — enforces minimum call spacing.
  lastClaudeCallAt: number | null;
  // Time the screen hash last changed — drives the stall check-in ladder.
  lastScreenChangeAt: number | null;
  // Time of the last check_in, so we don't pester.
  lastCheckInAt: number | null;
  // Expected pace of the current step, from Claude — scales stall patience.
  currentPace: StepPace;
  // How the coach is helping right now: guiding step by step, or watching
  // quietly. Set by the coach; picks the loop cadence and the bounce rule.
  stance: Stance;
  // A long goal's stage titles and which one the user is on (0-based). Empty
  // for a quick question or a short walkthrough. Set by the coach.
  stages: string[];
  stageIndex: number;
  // What the background tidy-up left on this chat, restored on reopen and
  // carried through every save.
  tidy: ChatTidy | null;
  // Set when a saved chat is reopened and consumed by the first look, which
  // greets the user with where things stood.
  resumePending: { awayMinutes: number; whereWeLeftOff: string } | null;
  // True while the agent is diagnosing/fixing a visible failure — drives the
  // "Troubleshooting…" UI state.
  troubleshooting: boolean;
  // Visible outcome the agent expects from its last instruction; echoed back
  // to it next tick so it verifies the step happened before advancing.
  lastExpectedResult: string | null;
  // The user is holding push-to-talk (or the mic button) and speaking. While
  // true the loop must not tick and the coach must not speak — talking over
  // someone who is mid-sentence is the single rudest thing this app can do.
  listening: boolean;
  // Their speech is being transcribed. Distinct from "listening" so the UI can
  // show progress after they release the key.
  transcribing: boolean;
  // Live partial/last transcript, shown while the user talks so they can see
  // they were heard.
  lastTranscript: string | null;
  // Running token and dollar total for this session, so the cost of watching
  // someone's screen is visible rather than a surprise at the end of a month.
  usage: TokenUsage;
  costUsd: number;
  // Number of Claude calls this session — the denominator for "cost per call"
  // and a cheap sanity check on loop behaviour in the logs.
  claudeCalls: number;
  // The model the coach's last look actually ran on, as reported back with
  // the answer. Null until the first look of this sitting.
  model: string | null;
  // The open chat's id, minted at start (or restored on reopen) so autosave
  // and any memory learned mid-chat can be attributed to it. Null between
  // chats — the loop and its input trigger key off this.
  sessionId: string | null;
  // Facts recalled from earlier sessions, formatted for the prompt. Resolved
  // once at session start so the prompt prefix stays byte-stable across ticks.
  recalledMemory: string;

  setStatus(s: SessionStatus): void;
  setGoal(goal: string): void;
  // The coach said the goal back and is waiting on a yes. An empty goal
  // keeps the wording already there.
  proposeGoal(goal: string, doneWhen: string): void;
  // The coach moved on from the question, so the goal stands as agreed.
  agreeGoal(): void;
  setInstruction(text: string, code?: string): void;
  setActiveTool(tool: { name: string; detail: string } | null): void;
  setCompletedSteps(steps: string[]): void;
  // The coach reported its list of finished steps. New ones are appended to
  // the step log with the time; nothing already logged is changed.
  applyCompletedSteps(steps: string[], now: number): void;
  // Restore a saved chat into the live session.
  loadChat(chat: RestoredSession): void;
  setUpcomingSteps(steps: string[]): void;
  setDiverted(val: boolean): void;
  pushFrame(frame: CaptureFrame): void;
  appendTurn(turn: ConversationTurn): void;
  setError(message: string | null): void;
  setRateLimit(until: number | null): void;
  setDone(done: boolean): void;
  addUploadedContext(files: UploadedContext[]): void;
  // The coach wrote a note; `seen` is whether it read it on screen.
  appendAgentNote(note: string, seen: boolean, now: number): void;
  // The user corrected or forgot a note in About this chat.
  editAgentNote(id: string, text: string): void;
  forgetAgentNote(id: string, now: number): void;
  setLastProcessedHash(h: string | null): void;
  setPendingFollowUp(text: string | null): void;
  setLastSpokenInstruction(s: string | null): void;
  setLastSpokeAt(t: number | null): void;
  setLastClaudeCallAt(t: number | null): void;
  setLastScreenChangeAt(t: number | null): void;
  setLastCheckInAt(t: number | null): void;
  setCurrentPace(p: StepPace): void;
  setStance(s: Stance): void;
  // The coach laid out, changed, or advanced the stages of a long plan.
  // `stageNumber` counts from 1; null for either means "unchanged".
  applyStages(stages: string[] | null, stageNumber: number | null): void;
  setResumePending(r: { awayMinutes: number; whereWeLeftOff: string } | null): void;
  setTroubleshooting(v: boolean): void;
  setLastExpectedResult(s: string | null): void;
  setListening(v: boolean): void;
  setTranscribing(v: boolean): void;
  setLastTranscript(t: string | null): void;
  recordUsage(usage: TokenUsage, costUsd: number): void;
  setModel(model: string): void;
  setSessionId(id: string | null): void;
  setRecalledMemory(text: string): void;
  reset(): void;
}

const MAX_FRAMES = 5;

const initial = {
  status: "idle" as SessionStatus,
  goal: null,
  agreedGoal: "",
  doneWhen: "",
  goalPending: false,
  currentInstruction: "",
  currentCode: "",
  activeTool: null as { name: string; detail: string } | null,
  completedSteps: [] as string[],
  stepLog: [] as StepLogEntry[],
  upcomingSteps: [] as string[],
  diverted: false,
  conversation: [] as ConversationTurn[],
  frames: [] as CaptureFrame[],
  lastError: null,
  rateLimitUntil: null,
  done: false,
  uploadedContext: "",
  attachedFileNames: [] as string[],
  agentNotes: [] as ChatNote[],
  lastProcessedHash: null as string | null,
  pendingFollowUp: null as string | null,
  lastSpokenInstruction: null as string | null,
  lastSpokeAt: null as number | null,
  lastClaudeCallAt: null as number | null,
  lastScreenChangeAt: null as number | null,
  lastCheckInAt: null as number | null,
  currentPace: "medium" as StepPace,
  stance: "guide" as Stance,
  stages: [] as string[],
  stageIndex: 0,
  tidy: null as ChatTidy | null,
  resumePending: null as { awayMinutes: number; whereWeLeftOff: string } | null,
  troubleshooting: false,
  lastExpectedResult: null as string | null,
  listening: false,
  transcribing: false,
  lastTranscript: null as string | null,
  usage: { ...EMPTY_USAGE },
  costUsd: 0,
  claudeCalls: 0,
  model: null as string | null,
  sessionId: null as string | null,
  recalledMemory: "",
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  setStatus: (s) => set({ status: s }),
  setGoal: (goal) => set({ goal }),
  proposeGoal: (goal, doneWhen) =>
    set(goal ? { agreedGoal: goal, doneWhen, goalPending: true } : { goalPending: true }),
  agreeGoal: () => set({ goalPending: false }),
  setInstruction: (text, code = "") =>
    set({ currentInstruction: text, currentCode: code }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setCompletedSteps: (steps) => set({ completedSteps: steps }),
  applyCompletedSteps: (steps, now) =>
    set((state) => {
      const stepLog = appendToStepLog(
        state.stepLog,
        steps,
        now,
        state.stages[state.stageIndex],
      );
      if (stepLog === state.stepLog) return state;
      // The coach is shown the log's own wording next look, so its list and
      // the log cannot drift apart.
      return { stepLog, completedSteps: stepLog.map((e) => e.text) };
    }),
  loadChat: (chat) => set({ ...chat }),
  setUpcomingSteps: (steps) => set({ upcomingSteps: steps }),
  setDiverted: (val) => set({ diverted: val }),
  pushFrame: (frame) =>
    set((state) => ({
      frames: [...state.frames, frame].slice(-MAX_FRAMES),
    })),
  appendTurn: (turn) =>
    set((state) => ({ conversation: [...state.conversation, turn] })),
  setError: (message) => set({ lastError: message }),
  setRateLimit: (until) => set({ rateLimitUntil: until }),
  setDone: (done) => set({ done }),
  addUploadedContext: (files) =>
    set((state) => {
      const additions = files
        .map((f) => `--- ${f.name} ---\n${f.text}`)
        .join("\n\n");
      return {
        uploadedContext: state.uploadedContext
          ? `${state.uploadedContext}\n\n${additions}`
          : additions,
        attachedFileNames: [
          ...state.attachedFileNames,
          ...files.map((f) => f.name),
        ],
      };
    }),
  appendAgentNote: (note, seen, now) =>
    set((state) => {
      const agentNotes = addNote(state.agentNotes, note, seen, now, newNoteId(now));
      return agentNotes === state.agentNotes ? state : { agentNotes };
    }),
  editAgentNote: (id, text) =>
    set((state) => {
      const agentNotes = editNote(state.agentNotes, id, text);
      return agentNotes === state.agentNotes ? state : { agentNotes };
    }),
  forgetAgentNote: (id, now) =>
    set((state) => {
      const agentNotes = forgetNote(state.agentNotes, id, now);
      return agentNotes === state.agentNotes ? state : { agentNotes };
    }),
  setLastProcessedHash: (h) => set({ lastProcessedHash: h }),
  setPendingFollowUp: (text) => set({ pendingFollowUp: text }),
  setLastSpokenInstruction: (s) => set({ lastSpokenInstruction: s }),
  setLastSpokeAt: (t) => set({ lastSpokeAt: t }),
  setLastClaudeCallAt: (t) => set({ lastClaudeCallAt: t }),
  setLastScreenChangeAt: (t) => set({ lastScreenChangeAt: t }),
  setLastCheckInAt: (t) => set({ lastCheckInAt: t }),
  setCurrentPace: (p) => set({ currentPace: p }),
  setStance: (s) => set({ stance: s }),
  applyStages: (stages, stageNumber) =>
    set((state) => {
      const next = stages && stages.length > 0 ? stages : state.stages;
      const wanted = stageNumber !== null ? stageNumber - 1 : state.stageIndex;
      return { stages: next, stageIndex: clampStage(wanted, next.length) };
    }),
  setResumePending: (r) => set({ resumePending: r }),
  setTroubleshooting: (v) => set({ troubleshooting: v }),
  setLastExpectedResult: (s) => set({ lastExpectedResult: s }),
  setListening: (v) => set({ listening: v }),
  setTranscribing: (v) => set({ transcribing: v }),
  setLastTranscript: (t) => set({ lastTranscript: t }),
  setSessionId: (id) => set({ sessionId: id }),
  setRecalledMemory: (text) => set({ recalledMemory: text }),
  recordUsage: (usage, costUsd) =>
    set((state) => ({
      usage: addUsage(state.usage, usage),
      costUsd: state.costUsd + costUsd,
      claudeCalls: state.claudeCalls + 1,
    })),
  setModel: (model) => set({ model }),
  reset: () => set({ ...initial }),
}));
