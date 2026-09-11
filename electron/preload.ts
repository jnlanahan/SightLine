import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiKeyStatus,
  AgentDescriptor,
  AppMode,
  Clarification,
  CaptureFrame,
  CaptureRegion,
  CaptureTarget,
  ClarificationResponse,
  ConversationTurn,
  DockState,
  ElevenVoiceOption,
  GoalEvaluation,
  HighlightRect,
  InstructionResponse,
  SessionPlan,
  Settings,
  TtsEngine,
  UploadedContext,
} from "./types";
import type {
  MemoryFact,
  MemoryKind,
  SessionRecord,
  SessionSummary,
  TrainingPlan,
} from "./db/schema";
import type { CurriculumOutline, ModuleTaskDetail } from "./training-plan";
import type { NextInstructionArgs } from "./claude";

export interface SightLineApi {
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  keys: {
    status(): Promise<ApiKeyStatus>;
  };
  capture: {
    once(displayId: string | null): Promise<CaptureFrame>;
    // Every screen with a live thumbnail — for the visual screen picker.
    listTargets(): Promise<CaptureTarget[]>;
    // Re-run the pixel-probe that maps capture sources to physical displays
    // (screens flash briefly).
    recalibrate(): Promise<{ complete: boolean }>;
  };
  files: {
    pickContext(): Promise<UploadedContext[]>;
  };
  agent: {
    /**
     * Ask the agent for this mode how it wants to be ticked. Called once at
     * session start; the returned LoopPolicy drives the renderer's loop.
     */
    describe(args: { mode: AppMode }): Promise<AgentDescriptor>;
  };
  claude: {
    nextInstruction(args: NextInstructionArgs): Promise<
      | InstructionResponse
      | { __error: "missing_api_key" }
      | { __error: "rate_limited"; retryAfterSec: number }
      | { __error: "request_failed"; message: string }
    >;
    getClarifications(args: { mode: AppMode; goal: string }): Promise<
      ClarificationResponse | { __error: string; message?: string }
    >;
    getSessionPlan(args: {
      mode: AppMode;
      goal: string;
      clarifications: Clarification[];
      screenshot?: string;
    }): Promise<SessionPlan | { __error: string; message?: string }>;
    // Training mode: the full curriculum outline (modules + draft task
    // titles). Null when generation failed — keep the user at the review step.
    getCurriculumOutline(args: {
      goal: string;
      clarifications: Clarification[];
      screenshot?: string;
    }): Promise<CurriculumOutline | null | { __error: string; message?: string }>;
    // Training mode: objectives + done-criteria for one module, written with
    // the plan's journal in view. Null on failure — retry at next session start.
    detailModule(args: {
      plan: TrainingPlan;
      moduleIndex: number;
    }): Promise<ModuleTaskDetail[] | null | { __error: string; message?: string }>;
    // Fires once per completed sentence of the instruction while Claude's
    // response is still streaming — lets TTS start on the first sentence.
    onSpeechChunk(cb: (chunk: { text: string; index: number }) => void): () => void;
    evaluateGoal(args: {
      mode: AppMode;
      goal: string;
      completedSteps: string[];
      conversation: ConversationTurn[];
      frames: CaptureFrame[];
    }): Promise<GoalEvaluation | { __error: string; message?: string }>;
  };
  whisper: {
    transcribe(args: {
      audioBase64: string;
      mimeType: string;
    }): Promise<{ text: string } | { __error: string; message?: string }>;
  };
  window: {
    setOpacity(opacity: number): Promise<void>;
    setCollapsed(collapsed: boolean): Promise<void>;
    minimize(): Promise<void>;
    openExternal(url: string): Promise<void>;
    // Manual window dragging — CSS app-region drag is unreliable for
    // transparent frameless windows on Windows, so the renderer drives it.
    dragStart(): void;
    dragEnd(): void;
  };
  tts: {
    // previousText is what the coach already said in THIS response; it keeps
    // prosody continuous across sentence-by-sentence synthesis.
    speak(text: string, previousText?: string): Promise<
      | { audioBase64: string; engine: TtsEngine; cached: boolean; ms: number }
      | { __error: "missing_tts_provider"; message: string }
      | { __error: "request_failed"; message: string }
    >;
    // ElevenLabs voices available on the configured account, for the picker.
    listVoices(): Promise<ElevenVoiceOption[]>;
  };
  research: {
    search(query: string): Promise<{ text: string } | { __error: string; message?: string }>;
  };
  overlay: {
    setAdjust(adjust: boolean): Promise<void>;
    onRegionUpdated(cb: (region: CaptureRegion | null) => void): () => void;
    // Flash a short glow over an on-screen element. Coordinates are
    // fractions (0-1) of the latest captured frame.
    flashHighlight(rect: HighlightRect): Promise<void>;
  };
  input: {
    onActivity(cb: () => void): () => void;
  };
  voice: {
    // Fires on the press and release edges of the push-to-talk key. Watched
    // globally in the main process, since SightLine rarely has focus while
    // the user works in the app being coached.
    onPushToTalk(cb: (down: boolean) => void): () => void;
  };
  dock: {
    // Dock/undock the panel as a Windows AppBar on the watched monitor.
    // Resolves with the resulting state (docked stays false if the FFI layer
    // is unavailable — the app keeps floating).
    set(docked: boolean): Promise<DockState & { available: boolean }>;
    // Change the reserved strip width (DIP); persisted. Returns the clamped width.
    resize(width: number): Promise<number>;
    state(): Promise<DockState>;
    // Fires on every dock transition, including involuntary ones (docked
    // monitor unplugged) and width changes.
    onChanged(cb: (state: DockState) => void): () => void;
  };
  history: {
    list(): Promise<SessionSummary[]>;
    get(id: string): Promise<SessionRecord | null>;
    save(record: SessionRecord): Promise<{ saved: boolean }>;
    delete(id: string): Promise<{ deleted: boolean }>;
  };
  memory: {
    // Rank what's known against this goal. Returns the prompt text to hand
    // the agent plus the facts themselves, so the UI can show what it recalled.
    recall(goal: string): Promise<{ text: string; facts: MemoryFact[] }>;
    add(
      kind: MemoryKind,
      content: string,
      sessionId: string | null,
    ): Promise<{ added: boolean; reason?: "duplicate"; fact?: MemoryFact }>;
    list(): Promise<MemoryFact[]>;
    forget(id: string): Promise<{ forgotten: boolean }>;
  };
  plans: {
    list(): Promise<TrainingPlan[]>;
    save(plan: TrainingPlan): Promise<{ saved: boolean }>;
    delete(id: string): Promise<{ deleted: boolean }>;
    // One stored frame per "Check my work" press — the user-approved
    // exception to "screenshots never persist". Deleted with the plan.
    saveFrame(args: {
      planId: string;
      frameId: string;
      dataUrl: string;
    }): Promise<{ file: string | null }>;
    loadFrame(args: {
      planId: string;
      frameFile: string;
    }): Promise<{ dataUrl: string | null }>;
  };
  app: {
    quit(): Promise<void>;
    // Reveal the diagnostic log file in Explorer.
    openLogs(): Promise<void>;
  };
  log(message: string): void;
}

const api: SightLineApi = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
  },
  keys: {
    status: () => ipcRenderer.invoke("keys:get-status"),
  },
  capture: {
    once: (displayId) => ipcRenderer.invoke("capture:once", { displayId }),
    listTargets: () => ipcRenderer.invoke("capture:list-targets"),
    recalibrate: () => ipcRenderer.invoke("capture:recalibrate"),
  },
  files: {
    pickContext: () => ipcRenderer.invoke("files:pick-context"),
  },
  agent: {
    describe: (args) => ipcRenderer.invoke("agent:describe", args),
  },
  claude: {
    nextInstruction: (args) =>
      ipcRenderer.invoke("claude:next-instruction", args),
    getClarifications: (args) =>
      ipcRenderer.invoke("claude:get-clarifications", args),
    getSessionPlan: (args) =>
      ipcRenderer.invoke("claude:get-session-plan", args),
    getCurriculumOutline: (args) =>
      ipcRenderer.invoke("claude:curriculum-outline", args),
    detailModule: (args) => ipcRenderer.invoke("claude:detail-module", args),
    onSpeechChunk: (cb) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        chunk: { text: string; index: number },
      ) => cb(chunk);
      ipcRenderer.on("claude:speech-chunk", handler);
      return () => ipcRenderer.removeListener("claude:speech-chunk", handler);
    },
    evaluateGoal: (args) => ipcRenderer.invoke("claude:evaluate-goal", args),
  },
  whisper: {
    transcribe: (args) => ipcRenderer.invoke("whisper:transcribe", args),
  },
  window: {
    setOpacity: (opacity) =>
      ipcRenderer.invoke("window:set-opacity", { opacity }),
    setCollapsed: (collapsed) =>
      ipcRenderer.invoke("window:set-collapsed", { collapsed }),
    minimize: () => ipcRenderer.invoke("window:minimize"),
    openExternal: (url) =>
      ipcRenderer.invoke("window:open-external", { url }),
    dragStart: () => ipcRenderer.send("window:drag-start"),
    dragEnd: () => ipcRenderer.send("window:drag-end"),
  },
  tts: {
    speak: (text, previousText) =>
      ipcRenderer.invoke("tts:speak", { text, previousText }),
    listVoices: () => ipcRenderer.invoke("tts:list-voices"),
  },
  research: {
    search: (query) => ipcRenderer.invoke("research:search", { query }),
  },
  overlay: {
    setAdjust: (adjust) => ipcRenderer.invoke("overlay:set-adjust", { adjust }),
    onRegionUpdated: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, region: CaptureRegion | null) =>
        cb(region);
      ipcRenderer.on("overlay:region-updated", handler);
      return () => ipcRenderer.removeListener("overlay:region-updated", handler);
    },
    flashHighlight: (rect) => ipcRenderer.invoke("overlay:flash-highlight", rect),
  },
  input: {
    onActivity: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("input:activity", handler);
      return () => ipcRenderer.removeListener("input:activity", handler);
    },
  },
  voice: {
    onPushToTalk: (cb) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        payload: { down: boolean },
      ) => cb(Boolean(payload?.down));
      ipcRenderer.on("voice:ptt", handler);
      return () => ipcRenderer.removeListener("voice:ptt", handler);
    },
  },
  dock: {
    set: (docked) => ipcRenderer.invoke("dock:set", { docked }),
    resize: (width) => ipcRenderer.invoke("dock:resize", { width }),
    state: () => ipcRenderer.invoke("dock:state"),
    onChanged: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, state: DockState) =>
        cb(state);
      ipcRenderer.on("dock:changed", handler);
      return () => ipcRenderer.removeListener("dock:changed", handler);
    },
  },
  history: {
    list: () => ipcRenderer.invoke("history:list"),
    get: (id) => ipcRenderer.invoke("history:get", { id }),
    save: (record) => ipcRenderer.invoke("history:save", record),
    delete: (id) => ipcRenderer.invoke("history:delete", { id }),
  },
  memory: {
    recall: (goal) => ipcRenderer.invoke("memory:recall", { goal }),
    add: (kind, content, sessionId) =>
      ipcRenderer.invoke("memory:add", { kind, content, sessionId }),
    list: () => ipcRenderer.invoke("memory:list"),
    forget: (id) => ipcRenderer.invoke("memory:forget", { id }),
  },
  plans: {
    list: () => ipcRenderer.invoke("plans:list"),
    save: (plan) => ipcRenderer.invoke("plans:save", plan),
    delete: (id) => ipcRenderer.invoke("plans:delete", { id }),
    saveFrame: (args) => ipcRenderer.invoke("plans:save-frame", args),
    loadFrame: (args) => ipcRenderer.invoke("plans:load-frame", args),
  },
  app: {
    quit: () => ipcRenderer.invoke("app:quit"),
    openLogs: () => ipcRenderer.invoke("logs:open"),
  },
  log: (message) => ipcRenderer.send("session:log", message),
};

contextBridge.exposeInMainWorld("sightline", api);
