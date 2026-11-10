import type { SightLineApi } from "../../electron/preload";

declare global {
  interface Window {
    sightline: SightLineApi;
  }
}

export const api = (): SightLineApi => window.sightline;

export type {
  AccentName,
  AgentDescriptor,
  ApiKeyStatus,
  CaptureFrame,
  CaptureRegion,
  CaptureTarget,
  ConversationTurn,
  DisplayInfo,
  DockSide,
  DockState,
  ElevenVoiceOption,
  HighlightRect,
  InstructionAction,
  InstructionResponse,
  LoopPolicy,
  PushToTalkKey,
  Settings,
  SessionStatus,
  Stance,
  StepPace,
  TtsEngine,
  TtsPlaybackEngine,
  TtsProviderChoice,
  TtsVoiceId,
  UploadedContext,
} from "../../electron/types";

export type { TokenUsage } from "../../electron/usage";

export type {
  ChatRecord,
  ChatSummary,
  StepLogEntry,
} from "../../electron/db/schema";
