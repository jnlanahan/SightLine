// The data model, defined once.
//
// Everything persists locally today (see ./store.ts — JSON files under
// %APPDATA%/SightLine/data), but the shapes below are deliberately relational
// and the DDL at the bottom is the Postgres schema that mirrors them. Moving
// to Neon is then: run the DDL, implement the same repository interface
// against it, and hook up auth to populate user_id. No shape changes.
//
// Pure module — no Electron, no fs — so it is unit-testable and importable
// from the renderer.

import type { TokenUsage } from "../usage";

/**
 * A durable fact the coach learned about this user or their setup. This is
 * what makes it feel like the same person came back — "you're on the Windows
 * app, not the web one" should not have to be re-established every session.
 */
export type MemoryKind =
  | "setup" // their environment: OS, app version, which account
  | "preference" // how they like to be helped
  | "history" // something they did in a previous session
  | "obstacle"; // a problem they hit before, and what fixed it

export interface MemoryFact {
  id: string;
  userId: string | null;
  kind: MemoryKind;
  content: string;
  // The chat (or, for facts learned before chats existed, the old session)
  // the fact came from. A plain id: nothing it names lives in this schema.
  sourceSessionId: string | null;
  createdAt: number;
  // Touched whenever the fact is surfaced to the agent — drives both ranking
  // and pruning, so facts that never prove useful fade out.
  lastUsedAt: number;
  useCount: number;
  // Facts the user explicitly removed. Kept rather than deleted so the same
  // fact isn't immediately re-learned and re-surfaced.
  archived: boolean;
  // True when the coach read the fact on the user's screen, or the user
  // confirmed it. False when it was only told or assumed. Optional because
  // facts saved before this existed have no such field: missing means false.
  verified?: boolean;
}

/**
 * One thing the coach noted to itself in a chat — the chat's own memory.
 *
 * Notes are never deleted: one the user forgets, or one pushed out by the
 * cap, gets a retired time and is no longer shown to the coach. Keeping it
 * stops the coach writing the same note straight back.
 */
export interface ChatNote {
  id: string;
  text: string;
  // True when the coach read this on screen the turn it wrote it; false when
  // it was told, inferred or assumed.
  seen: boolean;
  // When the note was written.
  at: number;
  // When it was forgotten or pushed out by the cap. Null while live.
  retiredAt: number | null;
  // The user corrected the wording by hand. The tidy-up never retires or
  // rewrites such a note.
  edited?: boolean;
  // What the note said before the user corrected it. Kept so the coach
  // writing the old, wrong wording again is recognised as a repeat.
  previous?: string[];
}

/**
 * What the background tidy-up left on a chat the last time it ran: a better
 * summary than the mechanical one, and a line telling the user what it did.
 * `turns` is how long the transcript was at that point — once the chat has
 * moved on, the summary is stale and the mechanical one takes over again.
 */
export interface ChatTidy {
  turns: number;
  at: number;
  whereWeLeftOff: string;
  changed: string;
}

/** One finished step and when it was done. The step log only ever grows. */
export interface StepLogEntry {
  text: string;
  at: number;
  // The stage of a long plan this step belonged to, by title. Absent for
  // chats without stages.
  stage?: string;
}

/** One message in a chat's transcript. */
export interface ChatTurnRecord {
  role: "user" | "assistant";
  content: string;
  // Copyable code or a command that came with a coach line.
  code?: string;
  at: number;
  // Which stage (0-based) and step (global, 1-based) were in progress when
  // the turn was added. Absent on chats saved before the redesign.
  stage?: number;
  step?: number;
}

/**
 * A chat: one goal, saved so it can be left and reopened. This — not the
 * session — is the unit of work. A quick question and a month-long project
 * are the same record; the long one just holds more.
 */
export interface ChatRecord {
  id: string;
  // Null until auth exists, like every other table.
  userId: string | null;
  title: string;
  // The goal in the user's own words.
  goal: string;
  // The goal as the coach said it back, and what done will look like. Empty
  // for a quick question, which is answered without agreeing anything.
  // `goalPending` is true while the user has still to say yes. Optional
  // because chats saved before goals were agreed have none of the three:
  // missing means no agreed goal, and nothing waiting on a yes.
  agreedGoal?: string;
  doneWhen?: string;
  goalPending?: boolean;
  state: "active" | "done";
  createdAt: number;
  lastActiveAt: number;
  // How the coach was helping when the chat was last active.
  stance: "guide" | "watch";
  // The audit trail: every finished step with its time, append-only.
  stepLog: StepLogEntry[];
  // The step or task in flight when the chat was left, and what done looks
  // like for it.
  currentStep: string;
  currentCode: string;
  expectedResult: string | null;
  upcomingSteps: string[];
  // A long goal's stage titles and which one the user is on (0-based). Empty
  // for a quick question or a short walkthrough. Chats saved before stages
  // existed have neither field; chat-record.ts fills them in on read.
  stages: string[];
  stageIndex: number;
  // One or two sentences, rebuilt on every save with no model call.
  whereWeLeftOff: string;
  // What the coach noted to itself in this chat, live and retired. Chats
  // saved before notes had ids hold plain strings here; chat-record.ts
  // converts them on read.
  notes: ChatNote[];
  turns: ChatTurnRecord[];
  // Reference files the user attached, kept so a reopened chat still has them.
  uploadedContext: string;
  attachedFileNames: string[];
  // Running totals across every sitting.
  usage: TokenUsage;
  costUsd: number;
  claudeCalls: number;
  // Absent until the chat has been tidied once.
  tidy?: ChatTidy;
}

/** Lightweight row for the chat list — no transcript, no log. */
export interface ChatSummary {
  id: string;
  userId: string | null;
  title: string;
  goal: string;
  state: ChatRecord["state"];
  createdAt: number;
  lastActiveAt: number;
  whereWeLeftOff: string;
  stepsDone: number;
  // Enough has happened since the last tidy-up to run another.
  needsTidy: boolean;
}

/**
 * Postgres DDL matching the interfaces above. Applied as-is to a Neon
 * database when the app moves off local storage. Kept beside the types on
 * purpose: if one changes and the other doesn't, the drift is visible in the
 * same file rather than across a migrations directory nobody opens.
 */
export const POSTGRES_SCHEMA = `
-- SightLine schema (v1)
-- Apply to a Neon Postgres database:  psql "$DATABASE_URL" -f schema.sql

create extension if not exists "pgcrypto";

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

create table if not exists memory_facts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references users(id) on delete cascade,
  kind               text not null
                       check (kind in ('setup','preference','history','obstacle')),
  content            text not null,
  source_session_id  text,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz not null default now(),
  use_count          integer not null default 0,
  archived           boolean not null default false,
  verified           boolean not null default false
);
create index if not exists memory_facts_user_idx
  on memory_facts (user_id, archived, last_used_at desc);

create table if not exists chats (
  id                   text primary key,
  user_id              uuid references users(id) on delete cascade,
  title                text not null,
  goal                 text not null,
  agreed_goal          text not null default '',
  done_when            text not null default '',
  goal_pending         boolean not null default false,
  state                text not null default 'active'
                         check (state in ('active','done')),
  created_at           timestamptz not null,
  last_active_at       timestamptz not null,
  stance               text not null default 'guide'
                         check (stance in ('guide','watch')),
  step_log             jsonb not null default '[]'::jsonb,
  current_step         text not null default '',
  current_code         text not null default '',
  expected_result      text,
  upcoming_steps       jsonb not null default '[]'::jsonb,
  stages               jsonb not null default '[]'::jsonb,
  stage_index          integer not null default 0,
  tidy                 jsonb,
  where_we_left_off    text not null default '',
  -- [{ id, text, seen, at, retiredAt }], live and retired alike
  notes                jsonb not null default '[]'::jsonb,
  -- [{ role, content, code?, at, stage?, step? }]
  turns                jsonb not null default '[]'::jsonb,
  uploaded_context     text not null default '',
  attached_file_names  jsonb not null default '[]'::jsonb,
  usage                jsonb not null default '{}'::jsonb,
  cost_usd             numeric(10,4) not null default 0,
  claude_calls         integer not null default 0
);
create index if not exists chats_user_active_idx
  on chats (user_id, last_active_at desc);
`.trim();
