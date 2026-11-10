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

export type SessionOutcome = "completed" | "abandoned" | "unknown";

/** One coaching session, start to finish. */
export interface SessionRecord {
  id: string;
  // Null until auth exists. Every row carries it now so the migration is a
  // backfill rather than a schema change.
  userId: string | null;
  mode: "tech_support" | "training" | "teacher" | "coach";
  goal: string;
  startedAt: number;
  endedAt: number | null;
  outcome: SessionOutcome;
  // The goal-evaluation verdict, when the user asked for one.
  verdict: string | null;
  // Denormalized totals — cheap to read for history and analytics without
  // walking every turn.
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  claudeCalls: number;
  steps: SessionStepRecord[];
  turns: SessionTurnRecord[];
}

/** A step in the session's plan and how it went. */
export interface SessionStepRecord {
  idx: number;
  description: string;
  state: "completed" | "current" | "upcoming";
  expectedResult: string | null;
  completedAt: number | null;
}

/** One message in the transcript. */
export interface SessionTurnRecord {
  idx: number;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

/** Lightweight row for the history list — no transcript, no steps. */
export interface SessionSummary {
  id: string;
  userId: string | null;
  mode: SessionRecord["mode"];
  goal: string;
  startedAt: number;
  endedAt: number | null;
  outcome: SessionOutcome;
  costUsd: number;
  stepsCompleted: number;
}

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
  sourceSessionId: string | null;
  createdAt: number;
  // Touched whenever the fact is surfaced to the agent — drives both ranking
  // and pruning, so facts that never prove useful fade out.
  lastUsedAt: number;
  useCount: number;
  // Facts the user explicitly removed. Kept rather than deleted so the same
  // fact isn't immediately re-learned and re-surfaced.
  archived: boolean;
}

/** How one "Check my work" attempt on a task went. */
export interface TaskFeedback {
  at: number;
  verdict: "pass" | "not_yet";
  summary: string;
  // Filename under data/plan-frames/<planId>/ for the frame captured at this
  // check. The one user-approved exception to "screenshots never persist" —
  // exactly one frame per explicit button press, deleted with the plan.
  frameFile: string | null;
}

/** One unit of practice — sized to roughly one sitting. */
export interface TrainingTask {
  id: string;
  // Always present, even before the module is detailed.
  title: string;
  // "You will be able to X." Null until the module is detailed.
  objective: string | null;
  // Observable criteria the coach grades against. Empty until detailed.
  doneCriteria: string[];
  status: "not_started" | "in_progress" | "completed" | "skipped";
  feedback: TaskFeedback[];
  completedAt: number | null;
}

/** A small group of tasks with one theme. Module count scales with the goal. */
export interface TrainingModule {
  id: string;
  title: string;
  // One line: what this module covers and why it comes next.
  summary: string;
  // Whether objectives/doneCriteria have been written yet. Modules are
  // outlined up front but detailed lazily, informed by how earlier modules
  // actually went.
  detailed: boolean;
  status: "not_started" | "in_progress" | "completed";
  tasks: TrainingTask[];
}

export interface TrainingJournalEntry {
  at: number;
  sessionId: string;
  note: string;
}

/**
 * A multi-session curriculum the coach designed and walks the user through.
 * This — not the session — is the unit of long-term progress in Training
 * mode: sessions come and go, the plan accumulates.
 */
export interface TrainingPlan {
  id: string;
  userId: string | null;
  title: string;
  goal: string;
  // Distilled from the intake interview: skill level, pace, learning style.
  learnerProfile: string;
  // One-paragraph plan summary, spoken once at plan creation.
  overview: string;
  modules: TrainingModule[];
  // Single progress pointer: indices into modules / tasks.
  cursor: { module: number; task: number };
  // Recurring mistake kinds the coach has noticed. Capped and deduped.
  mistakePatterns: string[];
  // ~3 lines, overwritten at each session end. The only orientation a fresh
  // session needs — the PROGRESS.md idea.
  whereWeLeftOff: string;
  // ~1 mechanical entry per session.
  journal: TrainingJournalEntry[];
  createdAt: number;
  updatedAt: number;
  sourceSessionId: string | null;
  // How many sessions have been started against this plan.
  runCount: number;
}

/** One finished step and when it was done. The step log only ever grows. */
export interface StepLogEntry {
  text: string;
  at: number;
}

/** One message in a chat's transcript. */
export interface ChatTurnRecord {
  role: "user" | "assistant";
  content: string;
  // Copyable code or a command that came with a coach line.
  code?: string;
  at: number;
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
  // One or two sentences, rebuilt on every save with no model call.
  whereWeLeftOff: string;
  // What the coach noted to itself in this chat.
  notes: string[];
  turns: ChatTurnRecord[];
  // Reference files the user attached, kept so a reopened chat still has them.
  uploadedContext: string;
  attachedFileNames: string[];
  // Running totals across every sitting.
  usage: TokenUsage;
  costUsd: number;
  claudeCalls: number;
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

create table if not exists sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references users(id) on delete cascade,
  mode                text not null check (mode in ('tech_support','training','teacher','coach')),
  goal                text not null,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  outcome             text not null default 'unknown'
                        check (outcome in ('completed','abandoned','unknown')),
  verdict             text,
  cost_usd            numeric(10,4) not null default 0,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  claude_calls        integer not null default 0
);
create index if not exists sessions_user_started_idx
  on sessions (user_id, started_at desc);

create table if not exists session_steps (
  id               bigserial primary key,
  session_id       uuid not null references sessions(id) on delete cascade,
  idx              integer not null,
  description      text not null,
  state            text not null check (state in ('completed','current','upcoming')),
  expected_result  text,
  completed_at     timestamptz,
  unique (session_id, idx)
);

create table if not exists session_turns (
  id          bigserial primary key,
  session_id  uuid not null references sessions(id) on delete cascade,
  idx         integer not null,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null,
  unique (session_id, idx)
);

create table if not exists memory_facts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references users(id) on delete cascade,
  kind               text not null
                       check (kind in ('setup','preference','history','obstacle')),
  content            text not null,
  source_session_id  uuid references sessions(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz not null default now(),
  use_count          integer not null default 0,
  archived           boolean not null default false
);
create index if not exists memory_facts_user_idx
  on memory_facts (user_id, archived, last_used_at desc);

create table if not exists training_plans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references users(id) on delete cascade,
  title              text not null,
  goal               text not null,
  learner_profile    text not null default '',
  overview           text not null default '',
  modules            jsonb not null default '[]'::jsonb,
  cursor             jsonb not null default '{"module":0,"task":0}'::jsonb,
  mistake_patterns   jsonb not null default '[]'::jsonb,
  where_we_left_off  text not null default '',
  journal            jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  source_session_id  uuid references sessions(id) on delete set null,
  run_count          integer not null default 0
);
create index if not exists training_plans_user_idx
  on training_plans (user_id, updated_at desc);

create table if not exists chats (
  id                   text primary key,
  user_id              uuid references users(id) on delete cascade,
  title                text not null,
  goal                 text not null,
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
  where_we_left_off    text not null default '',
  notes                jsonb not null default '[]'::jsonb,
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
