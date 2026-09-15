// Parsing for Claude's per-tick JSON response. Pure module (no Electron/SDK
// imports) so it is unit-testable from src/__tests__ — same pattern as
// speech-chunker.ts and dock-geometry.ts.

import type { HighlightRect, InstructionResponse, RememberedFact } from "./types";

const VALID_MEMORY_KINDS = new Set([
  "setup",
  "preference",
  "history",
  "obstacle",
]);

// A cross-session fact must be short and substantive. Anything longer is the
// agent narrating rather than recording, and would cost tokens on every tick
// of every future session.
const MAX_MEMORY_CHARS = 200;

export function parseRemember(raw: unknown): RememberedFact | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const content = typeof o.content === "string" ? o.content.trim() : "";
  if (!content || content.length > MAX_MEMORY_CHARS) return null;
  const kind =
    typeof o.kind === "string" && VALID_MEMORY_KINDS.has(o.kind)
      ? (o.kind as RememberedFact["kind"])
      : "history";
  return { kind, content };
}

const VALID_ACTIONS = new Set([
  "instruct",
  "wait",
  "acknowledge",
  "check_in",
  "done",
]);
const VALID_PACES = new Set(["quick", "medium", "long"]);

export function extractJson(text: string): string | null {
  // Strip code fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text.trim();
  // Find outermost { ... } pair.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

// Accept a highlight only when it's a plausible fractional box; clamp into
// [0,1] so a slightly-out-of-range value doesn't discard the whole thing.
export function parseHighlight(raw: unknown): HighlightRect | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const nums = [o.x, o.y, o.w, o.h];
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const x = clamp01(o.x as number);
  const y = clamp01(o.y as number);
  const w = Math.min(clamp01(o.w as number), 1 - x);
  const h = Math.min(clamp01(o.h as number), 1 - y);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export function parseInstruction(
  text: string,
  previousSteps: string[],
): InstructionResponse {
  const json = extractJson(text);
  if (json) {
    try {
      const obj = JSON.parse(json) as {
        action?: string;
        expected_pace?: string;
        instruction?: string;
        expected_result?: string;
        troubleshooting?: boolean;
        completed_steps?: string[];
        upcoming_steps?: string[];
        digression?: boolean;
        done?: boolean;
        needsResearch?: boolean;
        researchQuery?: string;
        notes?: string;
        highlight?: unknown;
        remember?: unknown;
      };
      // Modes that don't emit an action (training/teacher) default to
      // "instruct"/"done" so their behavior is unchanged.
      const action =
        obj.action && VALID_ACTIONS.has(obj.action)
          ? (obj.action as InstructionResponse["action"])
          : obj.done
            ? "done"
            : "instruct";
      const instruction = (obj.instruction ?? "").trim();
      return {
        action,
        expectedPace:
          obj.expected_pace && VALID_PACES.has(obj.expected_pace)
            ? (obj.expected_pace as InstructionResponse["expectedPace"])
            : "medium",
        instruction: action === "wait" ? instruction : instruction || text,
        code: "",
        expectedResult:
          action === "instruct" ? (obj.expected_result ?? "").trim() : "",
        troubleshooting: Boolean(obj.troubleshooting),
        // An explicit [] never replaces a non-empty list — the list only grows.
        completedSteps:
          Array.isArray(obj.completed_steps) &&
          (obj.completed_steps.length > 0 || previousSteps.length === 0)
            ? obj.completed_steps.map(String)
            : previousSteps,
        upcomingSteps: Array.isArray(obj.upcoming_steps)
          ? obj.upcoming_steps.map(String)
          : [],
        digression: Boolean(obj.digression),
        done: action === "done" || Boolean(obj.done),
        needsResearch: Boolean(obj.needsResearch),
        researchQuery: (obj.researchQuery ?? "").trim(),
        notes: (obj.notes ?? "").trim(),
        taskVerdict: null,
        mistakePattern: "",
        highlight: action === "instruct" ? parseHighlight(obj.highlight) : null,
        remember: parseRemember(obj.remember),
      };
    } catch {
      // fall through
    }
  }
  // Fallback: treat whole response as the instruction.
  return {
    action: "instruct",
    expectedPace: "medium",
    instruction: text || "Continue with the next step.",
    code: "",
    expectedResult: "",
    troubleshooting: false,
    completedSteps: previousSteps,
    upcomingSteps: [],
    digression: false,
    done: false,
    needsResearch: false,
    researchQuery: "",
    notes: "",
    taskVerdict: null,
    mistakePattern: "",
    highlight: null,
    remember: null,
  };
}
