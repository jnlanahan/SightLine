// Local persistence for chats and memory.
//
// Backed by JSON files under %APPDATA%/SightLine/data-v2. The volume is tiny —
// a few hundred chats of text — so a database process would be pure
// overhead here, and this keeps the app working with zero setup and zero
// network. The repository functions below are the seam: swapping them for
// Neon-backed implementations against ./schema.ts's DDL changes nothing above
// this file.
//
// Invariant: persistence is best-effort. Every read falls back to empty and
// every write swallows its error — losing a chat is bad, but taking a live
// coaching session down because a disk write failed is worse.

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { logLine } from "../log";
import {
  isChatId,
  isChatRecordShape,
  normalizeChatRecord,
  summarizeChat,
} from "../chat-record";
import { capFacts } from "../memory-rank";
import type {
  ChatRecord,
  ChatSummary,
  MemoryFact,
} from "./schema";

// Memory that grows without limit would eventually crowd out its own ranking.
const MAX_FACTS = 400;
// Forgotten facts are kept so they are not learned again; they get their own
// allowance so live facts can never crowd them out.
const MAX_ARCHIVED_FACTS = 400;
// Chats are the product now, so the cap is generous; it only stops the index
// growing without bound.
const MAX_CHATS = 500;

// The older builds' folder. Only read, once, to carry memory.json over; this
// build never writes to it.
function dataDir(): string {
  return path.join(app.getPath("userData"), "data");
}

// Where the one-coach app keeps its data. A separate folder from the older
// sessions and training plans, which are left exactly as they were — so
// running an older build against the same profile still works.
function chatDataDir(): string {
  return path.join(app.getPath("userData"), "data-v2");
}

function ensureDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    logLine(`[store] could not create ${dir}: ${String(err)}`);
    return false;
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): boolean {
  try {
    if (!ensureDir(path.dirname(file))) return false;
    // Write-then-rename: a crash mid-write can't leave truncated JSON that
    // would then fail to parse and silently read back as "no chats".
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    logLine(`[store] write failed for ${path.basename(file)}: ${String(err)}`);
    return false;
  }
}

// Sortable, collision-resistant, and readable in a directory listing.
export function newId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${stamp}${rand}`;
}

// ── Chats ──

function chatsDir(): string {
  return path.join(chatDataDir(), "chats");
}

function chatIndexFile(): string {
  return path.join(chatDataDir(), "chats-index.json");
}

/**
 * The file for a chat, or null if the id is not one this app minted.
 *
 * Every read, write and delete below goes through here. Ids arrive over IPC
 * from the renderer and become file names, so an unchecked one ("../../x")
 * could read, overwrite or delete a .json file anywhere the app can reach.
 */
function chatFile(id: unknown): string | null {
  if (!isChatId(id)) {
    logLine("[store] refused a chat id that is not in the expected form");
    return null;
  }
  return path.join(chatsDir(), `${id}.json`);
}

export function listChats(): ChatSummary[] {
  return readJson<ChatSummary[]>(chatIndexFile(), []);
}

export function getChat(id: string): ChatRecord | null {
  const file = chatFile(id);
  const record = file ? readJson<ChatRecord | null>(file, null) : null;
  if (!record) return null;
  if (!isChatRecordShape(record)) {
    logLine("[store] a saved chat is damaged and was not opened");
    return null;
  }
  return normalizeChatRecord(record);
}

export function saveChat(record: ChatRecord): boolean {
  const file = chatFile(record?.id);
  if (!file) return false;
  // The record arrives from the renderer. One missing its transcript or step
  // log would be written and then break the list for every chat.
  if (!isChatRecordShape(record)) {
    logLine("[store] refused to save a chat that is not in the expected shape");
    return false;
  }
  if (!writeJson(file, record)) return false;

  const index = listChats();
  const next = [summarizeChat(record), ...index.filter((c) => c.id !== record.id)]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, MAX_CHATS);
  writeJson(chatIndexFile(), next);

  // This runs after every turn, so only touch the folder when something
  // actually fell off the end of the index.
  const kept = new Set(next.map((c) => c.id));
  for (const dropped of index.filter((c) => !kept.has(c.id))) {
    const stale = chatFile(dropped.id);
    if (!stale) continue;
    try {
      fs.unlinkSync(stale);
    } catch {
      // pruning is best-effort
    }
  }
  return true;
}

export function deleteChat(id: string): boolean {
  const file = chatFile(id);
  if (!file) return false;
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
  return writeJson(
    chatIndexFile(),
    listChats().filter((c) => c.id !== id),
  );
}

// ── Memory facts ──

let memoryCarriedOver = false;

function memoryFile(): string {
  const file = path.join(chatDataDir(), "memory.json");
  // What the coach already knows about the user comes along, once. Copied,
  // not moved: the old file stays where the older build expects it.
  if (!memoryCarriedOver) {
    memoryCarriedOver = true;
    const old = path.join(dataDir(), "memory.json");
    try {
      if (!fs.existsSync(file) && fs.existsSync(old) && ensureDir(chatDataDir())) {
        // Copy, then rename: a crash mid-copy must not leave a truncated
        // file that reads as "no memory" and blocks the copy from re-running.
        const tmp = `${file}.tmp`;
        fs.copyFileSync(old, tmp);
        fs.renameSync(tmp, file);
        logLine("[store] carried memory.json over to data-v2");
      }
    } catch (err) {
      logLine(`[store] could not carry memory over: ${String(err)}`);
    }
  }
  return file;
}

export function listFacts(): MemoryFact[] {
  return readJson<MemoryFact[]>(memoryFile(), []);
}

export function saveFacts(facts: MemoryFact[]): boolean {
  return writeJson(memoryFile(), capFacts(facts, MAX_FACTS, MAX_ARCHIVED_FACTS));
}

export function addFact(fact: MemoryFact): boolean {
  return saveFacts([fact, ...listFacts()]);
}

/** Mark facts as surfaced — feeds ranking so useful memory stays on top. */
export function touchFacts(ids: readonly string[], now: number): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const next = listFacts().map((f) =>
    idSet.has(f.id) ? { ...f, lastUsedAt: now, useCount: f.useCount + 1 } : f,
  );
  saveFacts(next);
}

/** Archive rather than delete, so the same fact isn't relearned immediately. */
export function forgetFact(id: string): boolean {
  return saveFacts(
    listFacts().map((f) => (f.id === id ? { ...f, archived: true } : f)),
  );
}
