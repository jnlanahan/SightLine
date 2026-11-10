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
  AppMode,
  Clarification,
  CaptureFrame,
  CaptureRegion,
  CaptureTarget,
  ClarificationQuestion,
  ClarificationResponse,
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
  SessionPlan,
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
  TaskFeedback,
  TrainingModule,
  TrainingPlan,
  TrainingTask,
} from "../../electron/db/schema";
