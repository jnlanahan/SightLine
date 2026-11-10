// Chats: the saved, reopenable unit of work.
//
// A chat replaces both the old one-shot session record and the training plan.
// Every goal is a chat; leaving one saves it and opening one resumes it. This
// module is the bookkeeping between the live session (the renderer's store)
// and the saved record (./db/schema.ts → ChatRecord).
//
// Pure module — no Electron, no fs, no clock of its own (callers pass `now`) —
// so it is unit-testable and importable from the renderer.

import { normalizeNotes } from "./chat-notes";
import type {
  ChatNote,
  ChatRecord,
  ChatSummary,
  ChatTurnRecord,
  StepLogEntry,
} from "./db/schema";
import type { ConversationTurn, Stance } from "./types";
import type { TokenUsage } from "./usage";

// ── Ids ──

// A chat id becomes a file name, and it reaches the main process over IPC
// from the renderer. Only the exact shape the app mints is accepted
// ("chat_" + lowercase base-36), so an id can never carry a path separator
// or ".." and climb out of the chats folder.
const CHAT_ID = /^chat_[a-z0-9]{1,40}$/;

export function isChatId(id: unknown): id is string {
  return typeof id === "string" && CHAT_ID.test(id);
}

// ── The step log ──

/**
 * Record newly finished steps, stamped with the time.
 *
 * The coach reports its full list of completed steps every turn. The log is
 * the user's audit trail of what was actually done, so it is append-only: an
 * entry, once written, is never reworded, reordered, or removed, whatever the
 * coach's list says later. Only steps beyond the end of the log are new.
 */
export function appendToStepLog(
  log: readonly StepLogEntry[],
  completedSteps: readonly string[],
  now: number,
): StepLogEntry[] {
  const fresh = completedSteps
    .slice(log.length)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text, at: now }));
  return fresh.length === 0 ? (log as StepLogEntry[]) : [...log, ...fresh];
}

// ── Titles and the where-we-left-off line ──

const TITLE_MAX_CHARS = 48;

/** A short list title from the user's own words. A better one is written later. */
export function titleFromGoal(goal: string): string {
  const text = goal.trim().replace(/\s+/g, " ");
  if (text.length <= TITLE_MAX_CHARS) return text;
  const cut = text.slice(0, TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 16 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One or two plain sentences on where a chat stands, built from the record
 * with no model call — so it is right even after a crash or a force-quit.
 * Shown in the chat list, and handed to the coach when the chat is reopened.
 */
export function buildWhereWeLeftOff(input: {
  stepLog: readonly StepLogEntry[];
  currentStep: string;
  done: boolean;
}): string {
  const recent = input.stepLog.slice(-3).map((e) => e.text);
  if (input.done) {
    return recent.length > 0
      ? `Finished. Last steps: ${recent.join("; ")}.`
      : "Finished.";
  }
  const did =
    recent.length > 0
      ? `Done so far: ${recent.join("; ")}.`
      : "Nothing finished yet.";
  const next = input.currentStep.trim();
  return next ? `${did} Next: ${clip(next, 140)}` : did;
}

// ── Live session → saved record ──

/** Everything about the live session that a saved chat keeps. */
export interface ChatSnapshot {
  id: string;
  title: string;
  goal: string;
  createdAt: number;
  now: number;
  done: boolean;
  stance: Stance;
  stepLog: readonly StepLogEntry[];
  currentStep: string;
  currentCode: string;
  expectedResult: string | null;
  upcomingSteps: readonly string[];
  // Live and retired alike: a retired note is what stops the coach writing a
  // forgotten one straight back.
  notes: readonly ChatNote[];
  conversation: readonly ConversationTurn[];
  uploadedContext: string;
  attachedFileNames: readonly string[];
  // Running totals for the whole chat, across every sitting.
  usage: TokenUsage;
  costUsd: number;
  claudeCalls: number;
}

export function buildChatRecord(snapshot: ChatSnapshot): ChatRecord {
  const turns: ChatTurnRecord[] = snapshot.conversation.map((t) => ({
    role: t.role,
    content: t.content,
    // The old session record dropped code blocks; a reopened chat needs them.
    ...(t.code ? { code: t.code } : {}),
    at: t.timestamp,
  }));
  return {
    id: snapshot.id,
    userId: null,
    title: snapshot.title,
    goal: snapshot.goal,
    state: snapshot.done ? "done" : "active",
    createdAt: snapshot.createdAt,
    lastActiveAt: snapshot.now,
    stance: snapshot.stance,
    stepLog: [...snapshot.stepLog],
    currentStep: snapshot.currentStep,
    currentCode: snapshot.currentCode,
    expectedResult: snapshot.expectedResult,
    upcomingSteps: [...snapshot.upcomingSteps],
    whereWeLeftOff: buildWhereWeLeftOff({
      stepLog: snapshot.stepLog,
      currentStep: snapshot.currentStep,
      done: snapshot.done,
    }),
    notes: snapshot.notes.map((n) => ({ ...n })),
    turns,
    uploadedContext: snapshot.uploadedContext,
    attachedFileNames: [...snapshot.attachedFileNames],
    usage: { ...snapshot.usage },
    costUsd: snapshot.costUsd,
    claudeCalls: snapshot.claudeCalls,
  };
}

/**
 * A chat earns a place in the list once the coach has said something. A goal
 * submitted and abandoned before the first reply is not worth a row.
 */
export function isWorthSaving(record: ChatRecord): boolean {
  return record.turns.some((t) => t.role === "assistant");
}

export function summarizeChat(record: ChatRecord): ChatSummary {
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    goal: record.goal,
    state: record.state,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    whereWeLeftOff: record.whereWeLeftOff,
    stepsDone: record.stepLog.length,
  };
}

// ── Saved record → live session ──

/**
 * A chat as read from disk, in today's shape. Chats saved before notes had
 * ids hold them as plain strings; those are converted here, marked not seen.
 * Nothing is written back — the file changes only when the chat is next
 * saved in the ordinary way.
 */
export function normalizeChatRecord(record: ChatRecord): ChatRecord {
  return { ...record, notes: normalizeNotes(record.notes, record.createdAt) };
}

/** The session-store fields a reopened chat restores. */
export interface RestoredSession {
  goal: string;
  stance: Stance;
  stepLog: StepLogEntry[];
  completedSteps: string[];
  upcomingSteps: string[];
  currentInstruction: string;
  currentCode: string;
  lastExpectedResult: string | null;
  lastSpokenInstruction: string | null;
  agentNotes: ChatNote[];
  conversation: ConversationTurn[];
  uploadedContext: string;
  attachedFileNames: string[];
  done: boolean;
}

export function chatToSession(record: ChatRecord): RestoredSession {
  const conversation: ConversationTurn[] = record.turns.map((t) => ({
    role: t.role,
    content: t.content,
    ...(t.code ? { code: t.code } : {}),
    timestamp: t.at,
  }));
  const lastSaid = [...conversation].reverse().find((t) => t.role === "assistant");
  return {
    goal: record.goal,
    stance: record.stance,
    stepLog: [...record.stepLog],
    // The coach is shown the log's own wording, so its list and the log agree.
    completedSteps: record.stepLog.map((e) => e.text),
    upcomingSteps: [...record.upcomingSteps],
    currentInstruction: record.currentStep,
    currentCode: record.currentCode,
    lastExpectedResult: record.expectedResult,
    // So the repeat guard knows what was already said before the break.
    lastSpokenInstruction: lastSaid?.content ?? null,
    // Converted again here as well as on read, so a record from anywhere
    // (an older file, a test) restores with ids and flags intact.
    agentNotes: normalizeNotes(record.notes, record.createdAt),
    conversation,
    uploadedContext: record.uploadedContext,
    attachedFileNames: [...record.attachedFileNames],
    done: record.state === "done",
  };
}
