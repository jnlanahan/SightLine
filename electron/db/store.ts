// Local persistence for sessions, memory, and training plans.
//
// Backed by JSON files under %APPDATA%/SightLine/data. The volume is tiny —
// a few hundred sessions of text — so a database process would be pure
// overhead here, and this keeps the app working with zero setup and zero
// network. The repository functions below are the seam: swapping them for
// Neon-backed implementations against ./schema.ts's DDL changes nothing above
// this file.
//
// Invariant: persistence is best-effort. Every read falls back to empty and
// every write swallows its error — losing history is bad, but taking a live
// coaching session down because a disk write failed is worse.

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { logLine } from "../log";
import { isChatId, summarizeChat } from "../chat-record";
import type {
  ChatRecord,
  ChatSummary,
  MemoryFact,
  SessionRecord,
  SessionSummary,
  TrainingPlan,
} from "./schema";

// Keep the on-disk history bounded. Well beyond what anyone will scroll, and
// small enough that the index stays instant to load.
const MAX_SESSIONS = 500;
// Memory that grows without limit would eventually crowd out its own ranking.
const MAX_FACTS = 400;
// Training plans are few and long-lived; the cap is a runaway backstop.
const MAX_PLANS = 100;
// Chats are the product now, so the cap is generous; it only stops the index
// growing without bound.
const MAX_CHATS = 500;

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
    // would then fail to parse and silently read back as "no history".
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

// ── Sessions ──

function sessionsDir(): string {
  return path.join(dataDir(), "sessions");
}

function indexFile(): string {
  return path.join(dataDir(), "sessions-index.json");
}

function summarize(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    userId: record.userId,
    mode: record.mode,
    goal: record.goal,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    outcome: record.outcome,
    costUsd: record.costUsd,
    stepsCompleted: record.steps.filter((s) => s.state === "completed").length,
  };
}

export function saveSession(record: SessionRecord): boolean {
  const ok = writeJson(
    path.join(sessionsDir(), `${record.id}.json`),
    record,
  );
  if (!ok) return false;

  const index = listSessions();
  const next = [summarize(record), ...index.filter((s) => s.id !== record.id)]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_SESSIONS);
  writeJson(indexFile(), next);

  // Drop the detail files for anything that fell off the end of the index.
  const kept = new Set(next.map((s) => s.id));
  try {
    for (const file of fs.readdirSync(sessionsDir())) {
      if (!file.endsWith(".json")) continue;
      if (!kept.has(file.replace(/\.json$/, ""))) {
        fs.unlinkSync(path.join(sessionsDir(), file));
      }
    }
  } catch {
    // pruning is best-effort
  }
  return true;
}

export function listSessions(): SessionSummary[] {
  return readJson<SessionSummary[]>(indexFile(), []);
}

export function getSession(id: string): SessionRecord | null {
  const file = path.join(sessionsDir(), `${id}.json`);
  return readJson<SessionRecord | null>(file, null);
}

export function deleteSession(id: string): boolean {
  try {
    fs.unlinkSync(path.join(sessionsDir(), `${id}.json`));
  } catch {
    // already gone
  }
  return writeJson(
    indexFile(),
    listSessions().filter((s) => s.id !== id),
  );
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
  return file ? readJson<ChatRecord | null>(file, null) : null;
}

export function saveChat(record: ChatRecord): boolean {
  const file = chatFile(record?.id);
  if (!file) return false;
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
        fs.copyFileSync(old, file);
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
  // Prune the least useful first when over the cap: archived, then oldest-used.
  const trimmed =
    facts.length <= MAX_FACTS
      ? facts
      : [...facts]
          .sort((a, b) => {
            if (a.archived !== b.archived) return a.archived ? 1 : -1;
            return b.lastUsedAt - a.lastUsedAt;
          })
          .slice(0, MAX_FACTS);
  return writeJson(memoryFile(), trimmed);
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

// ── Training plans ──

function plansFile(): string {
  return path.join(dataDir(), "plans.json");
}

export function listPlans(): TrainingPlan[] {
  return readJson<TrainingPlan[]>(plansFile(), []).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function savePlan(plan: TrainingPlan): boolean {
  const others = listPlans().filter((p) => p.id !== plan.id);
  return writeJson(plansFile(), [plan, ...others].slice(0, MAX_PLANS));
}

export function deletePlan(id: string): boolean {
  deletePlanFrames(id);
  return writeJson(
    plansFile(),
    listPlans().filter((p) => p.id !== id),
  );
}

// ── Plan frames ──
//
// The one exception to "screenshots never persist": exactly one JPEG per
// explicit "Check my work" press, so the coach can compare an attempt to the
// previous one across sessions. Stored beside the data files, deleted with
// the plan.

function planFramesDir(planId: string): string {
  // Plan ids come from newId() — base36, no path characters — but sanitize
  // anyway since the id crosses IPC.
  return path.join(dataDir(), "plan-frames", planId.replace(/[^a-z0-9_-]/gi, ""));
}

/** Store a check-my-work frame (base64 JPEG, no data-URL prefix). */
export function savePlanFrame(
  planId: string,
  frameId: string,
  base64Jpeg: string,
): string | null {
  const dir = planFramesDir(planId);
  if (!ensureDir(dir)) return null;
  const name = `${frameId.replace(/[^a-z0-9_-]/gi, "")}.jpg`;
  try {
    fs.writeFileSync(path.join(dir, name), Buffer.from(base64Jpeg, "base64"));
    return name;
  } catch (err) {
    logLine(`[store] plan frame write failed: ${String(err)}`);
    return null;
  }
}

/** Read a stored frame back as base64, or null if missing. */
export function loadPlanFrame(planId: string, frameFile: string): string | null {
  try {
    const file = path.join(planFramesDir(planId), path.basename(frameFile));
    return fs.readFileSync(file).toString("base64");
  } catch {
    return null;
  }
}

export function deletePlanFrames(planId: string): void {
  try {
    fs.rmSync(planFramesDir(planId), { recursive: true, force: true });
  } catch {
    // best-effort, like every other delete here
  }
}
