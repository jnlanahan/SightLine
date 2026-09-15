import { create } from "zustand";
import { EMPTY_USAGE, addUsage } from "../../electron/usage";
import type {
  AppMode,
  CaptureFrame,
  ConversationTurn,
  SessionStatus,
  StepPace,
  TrainingPlan,
  TtsPlaybackEngine,
  TokenUsage,
  UploadedContext,
} from "../lib/api";

/**
 * Why the session is paused. "user" is a deliberate pause, "idle" is the loop
 * standing down, "budget" means the spend cap stopped it — the UI needs to
 * tell these apart because only one of them is the user's own doing.
 */
export type PauseReason = "user" | "idle" | "budget" | null;

export interface SessionState {
  status: SessionStatus;
  mode: AppMode | null;
  goal: string | null;
  currentInstruction: string;
  // Copyable code/command text that came with the current instruction.
  currentCode: string;
  // The mid-turn tool the agent is running right now (web search, zoomed
  // read), so the UI can say "Looking that up…" instead of a bare spinner.
  activeTool: { name: string; detail: string } | null;
  completedSteps: string[];
  upcomingSteps: string[];
  diverted: boolean;
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  lastError: string | null;
  rateLimitUntil: number | null;
  done: boolean;

  clarificationContext: string;
  // User-attached reference material (text/markdown), in-session only.
  uploadedContext: string;
  attachedFileNames: string[];
  // Durable notes the agent recorded this session, oldest to newest.
  agentNotes: string[];
  lastProcessedHash: string | null;
  pendingFollowUp: string | null;
  pauseReason: PauseReason;
  researchQuery: string | null;

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
  // True while the agent is diagnosing/fixing a visible failure — drives the
  // "Troubleshooting…" UI state.
  troubleshooting: boolean;
  // Visible outcome the agent expects from its last instruction; echoed back
  // to it next tick so it verifies the step happened before advancing.
  lastExpectedResult: string | null;
  // Which TTS engine actually spoke last — lets the UI surface degradation
  // to the system voice instead of failing silently.
  lastTtsEngine: TtsPlaybackEngine | null;
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
  // Stable id for this session, minted at start so history and any memory
  // learned mid-session can be attributed before the session ends.
  sessionId: string | null;
  // Facts recalled from earlier sessions, formatted for the prompt. Resolved
  // once at session start so the prompt prefix stays byte-stable across ticks.
  recalledMemory: string;
  // Training mode: the persisted curriculum this session works against. The
  // renderer mutates it through the pure helpers in electron/training-plan.ts
  // and saves every change back through plans:save.
  activePlan: TrainingPlan | null;

  setStatus(s: SessionStatus): void;
  setMode(mode: AppMode | null): void;
  setGoal(goal: string): void;
  setInstruction(text: string, code?: string): void;
  setActiveTool(tool: { name: string; detail: string } | null): void;
  setCompletedSteps(steps: string[]): void;
  setUpcomingSteps(steps: string[]): void;
  setDiverted(val: boolean): void;
  pushFrame(frame: CaptureFrame): void;
  appendTurn(turn: ConversationTurn): void;
  setError(message: string | null): void;
  setRateLimit(until: number | null): void;
  setDone(done: boolean): void;
  setClarificationContext(ctx: string): void;
  addUploadedContext(files: UploadedContext[]): void;
  appendAgentNote(note: string): void;
  setLastProcessedHash(h: string | null): void;
  setPendingFollowUp(text: string | null): void;
  setPauseReason(r: PauseReason): void;
  setResearchQuery(q: string | null): void;
  setLastSpokenInstruction(s: string | null): void;
  setLastSpokeAt(t: number | null): void;
  setLastClaudeCallAt(t: number | null): void;
  setLastScreenChangeAt(t: number | null): void;
  setLastCheckInAt(t: number | null): void;
  setCurrentPace(p: StepPace): void;
  setTroubleshooting(v: boolean): void;
  setLastExpectedResult(s: string | null): void;
  setLastTtsEngine(e: TtsPlaybackEngine | null): void;
  setListening(v: boolean): void;
  setTranscribing(v: boolean): void;
  setLastTranscript(t: string | null): void;
  recordUsage(usage: TokenUsage, costUsd: number): void;
  setSessionId(id: string | null): void;
  setRecalledMemory(text: string): void;
  setActivePlan(plan: TrainingPlan | null): void;
  reset(): void;
}

const MAX_FRAMES = 5;

const initial = {
  status: "idle" as SessionStatus,
  mode: null as AppMode | null,
  goal: null,
  currentInstruction: "",
  currentCode: "",
  activeTool: null as { name: string; detail: string } | null,
  completedSteps: [] as string[],
  upcomingSteps: [] as string[],
  diverted: false,
  conversation: [] as ConversationTurn[],
  frames: [] as CaptureFrame[],
  lastError: null,
  rateLimitUntil: null,
  done: false,
  clarificationContext: "",
  uploadedContext: "",
  attachedFileNames: [] as string[],
  agentNotes: [] as string[],
  lastProcessedHash: null as string | null,
  pendingFollowUp: null as string | null,
  pauseReason: null as PauseReason,
  researchQuery: null as string | null,
  lastSpokenInstruction: null as string | null,
  lastSpokeAt: null as number | null,
  lastClaudeCallAt: null as number | null,
  lastScreenChangeAt: null as number | null,
  lastCheckInAt: null as number | null,
  currentPace: "medium" as StepPace,
  troubleshooting: false,
  lastExpectedResult: null as string | null,
  lastTtsEngine: null as TtsPlaybackEngine | null,
  listening: false,
  transcribing: false,
  lastTranscript: null as string | null,
  usage: { ...EMPTY_USAGE },
  costUsd: 0,
  claudeCalls: 0,
  sessionId: null as string | null,
  recalledMemory: "",
  activePlan: null as TrainingPlan | null,
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  setStatus: (s) => set({ status: s }),
  setMode: (mode) => set({ mode }),
  setGoal: (goal) => set({ goal }),
  setInstruction: (text, code = "") =>
    set({ currentInstruction: text, currentCode: code }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setCompletedSteps: (steps) => set({ completedSteps: steps }),
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
  setClarificationContext: (ctx) => set({ clarificationContext: ctx }),
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
  appendAgentNote: (note) =>
    set((state) =>
      state.agentNotes.includes(note)
        ? state
        : { agentNotes: [...state.agentNotes, note] },
    ),
  setLastProcessedHash: (h) => set({ lastProcessedHash: h }),
  setPendingFollowUp: (text) => set({ pendingFollowUp: text }),
  setPauseReason: (r) => set({ pauseReason: r }),
  setResearchQuery: (q) => set({ researchQuery: q }),
  setLastSpokenInstruction: (s) => set({ lastSpokenInstruction: s }),
  setLastSpokeAt: (t) => set({ lastSpokeAt: t }),
  setLastClaudeCallAt: (t) => set({ lastClaudeCallAt: t }),
  setLastScreenChangeAt: (t) => set({ lastScreenChangeAt: t }),
  setLastCheckInAt: (t) => set({ lastCheckInAt: t }),
  setCurrentPace: (p) => set({ currentPace: p }),
  setTroubleshooting: (v) => set({ troubleshooting: v }),
  setLastExpectedResult: (s) => set({ lastExpectedResult: s }),
  setLastTtsEngine: (e) => set({ lastTtsEngine: e }),
  setListening: (v) => set({ listening: v }),
  setTranscribing: (v) => set({ transcribing: v }),
  setLastTranscript: (t) => set({ lastTranscript: t }),
  setSessionId: (id) => set({ sessionId: id }),
  setRecalledMemory: (text) => set({ recalledMemory: text }),
  setActivePlan: (plan) => set({ activePlan: plan }),
  recordUsage: (usage, costUsd) =>
    set((state) => ({
      usage: addUsage(state.usage, usage),
      costUsd: state.costUsd + costUsd,
      claudeCalls: state.claudeCalls + 1,
    })),
  reset: () => set({ ...initial }),
}));
