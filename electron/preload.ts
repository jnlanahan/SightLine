import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiKeyStatus,
  AgentDescriptor,
  CaptureFrame,
  CaptureRegion,
  CaptureTarget,
  DockState,
  ElevenVoiceOption,
  HighlightRect,
  InstructionResponse,
  Settings,
  TtsEngine,
  UploadedContext,
} from "./types";
import type {
  MemoryFact,
  ChatRecord,
  ChatSummary,
  MemoryKind,
} from "./db/schema";
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
     * Ask the coach how it wants to be ticked. Called once per session; the
     * returned LoopPolicy drives the renderer's loop.
     */
    describe(): Promise<AgentDescriptor>;
  };
  claude: {
    nextInstruction(args: NextInstructionArgs): Promise<
      | InstructionResponse
      | { __error: "missing_api_key" }
      | { __error: "rate_limited"; retryAfterSec: number }
      | { __error: "request_failed"; message: string }
    >;
    // Fires once per completed sentence of the instruction while Claude's
    // response is still streaming — lets TTS start on the first sentence.
    onSpeechChunk(cb: (chunk: { text: string; index: number }) => void): () => void;
    // Fires when the agent starts a mid-turn tool (a web search, a zoomed
    // read). `detail` is the query or reason, for display.
    onToolStart(cb: (ev: { tool: string; detail: string }) => void): () => void;
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
  overlay: {
    setAdjust(adjust: boolean): Promise<void>;
    onRegionUpdated(cb: (region: CaptureRegion | null) => void): () => void;
    // Flash a short glow over an on-screen element. Coordinates are
    // fractions (0-1) of the latest captured frame.
    flashHighlight(rect: HighlightRect): Promise<void>;
  };
  input: {
    // `at` is when the input event itself happened, which can be up to the
    // main process's debounce earlier than this callback fires.
    onActivity(cb: (ev: { at: number }) => void): () => void;
  };
  voice: {
    // Fires on the press and release edges of the push-to-talk key. Watched
    // globally in the main process, since SightLine rarely has focus while
    // the user works in the app being coached.
    onPushToTalk(cb: (down: boolean) => void): () => void;
  };
  dock: {
    // Docking itself follows the dockEnabled setting (see settings:set in
    // main.ts); the renderer only resizes and observes.
    // Change the reserved strip width (DIP); persisted. Returns the clamped width.
    resize(width: number): Promise<number>;
    state(): Promise<DockState>;
    // Fires on every dock transition, including involuntary ones (docked
    // monitor unplugged) and width changes.
    onChanged(cb: (state: DockState) => void): () => void;
  };
  // Every goal is a chat: saved as it goes, listed on Home, reopenable.
  chats: {
    list(): Promise<ChatSummary[]>;
    get(id: string): Promise<ChatRecord | null>;
    save(record: ChatRecord): Promise<{ saved: boolean }>;
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
  app: {
    quit(): Promise<void>;
    // Reveal the diagnostic log file in Explorer.
    openLogs(): Promise<void>;
  };
  clipboard: {
    // Through the main process: the renderer's navigator.clipboard silently
    // fails when the panel isn't the focused window, which while coaching is
    // most of the time.
    write(text: string): Promise<boolean>;
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
    describe: () => ipcRenderer.invoke("agent:describe"),
  },
  claude: {
    nextInstruction: (args) =>
      ipcRenderer.invoke("claude:next-instruction", args),
    onSpeechChunk: (cb) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        chunk: { text: string; index: number },
      ) => cb(chunk);
      ipcRenderer.on("claude:speech-chunk", handler);
      return () => ipcRenderer.removeListener("claude:speech-chunk", handler);
    },
    onToolStart: (cb) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        ev: { tool: string; detail: string },
      ) => cb(ev);
      ipcRenderer.on("claude:tool-start", handler);
      return () => ipcRenderer.removeListener("claude:tool-start", handler);
    },
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
    dragStart: () => ipcRenderer.send("window:drag-start"),
    dragEnd: () => ipcRenderer.send("window:drag-end"),
  },
  tts: {
    speak: (text, previousText) =>
      ipcRenderer.invoke("tts:speak", { text, previousText }),
    listVoices: () => ipcRenderer.invoke("tts:list-voices"),
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
      const handler = (_: Electron.IpcRendererEvent, ev?: { at: number }) =>
        cb(ev ?? { at: Date.now() });
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
    resize: (width) => ipcRenderer.invoke("dock:resize", { width }),
    state: () => ipcRenderer.invoke("dock:state"),
    onChanged: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, state: DockState) =>
        cb(state);
      ipcRenderer.on("dock:changed", handler);
      return () => ipcRenderer.removeListener("dock:changed", handler);
    },
  },
  chats: {
    list: () => ipcRenderer.invoke("chats:list"),
    get: (id) => ipcRenderer.invoke("chats:get", { id }),
    save: (record) => ipcRenderer.invoke("chats:save", record),
    delete: (id) => ipcRenderer.invoke("chats:delete", { id }),
  },
  memory: {
    recall: (goal) => ipcRenderer.invoke("memory:recall", { goal }),
    add: (kind, content, sessionId) =>
      ipcRenderer.invoke("memory:add", { kind, content, sessionId }),
    list: () => ipcRenderer.invoke("memory:list"),
    forget: (id) => ipcRenderer.invoke("memory:forget", { id }),
  },
  app: {
    quit: () => ipcRenderer.invoke("app:quit"),
    openLogs: () => ipcRenderer.invoke("logs:open"),
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke("clipboard:write", { text }),
  },
  log: (message) => ipcRenderer.send("session:log", message),
};

contextBridge.exposeInMainWorld("sightline", api);
