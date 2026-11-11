// The phase-chat screen's live view model.
//
// buildPhaseView (src/lib/phaseView.ts) is pure; what it cannot know from one
// snapshot is held here for the sitting: the current step's planned title,
// the layout floor (a chat never drops back to "quick"), and the plan changes
// seen since the chat was opened (the "Added" tags and the plan notes). None
// of it is saved — a reopened chat simply shows the plan as it is.

import { useRef } from "react";
import { useSession } from "../store/session";
import {
  buildPhaseView,
  diffPlan,
  layoutOf,
  stickyLayout,
  trackCurrentTitle,
  type Layout,
  type PhaseView,
  type TitleTrack,
} from "../lib/phaseView";

export interface PlanNote {
  text: string;
  /** The step in progress when the change was seen (the note goes under it). */
  step: number;
  at: number;
}

export interface LivePhaseView {
  view: PhaseView;
  notes: readonly PlanNote[];
  addedSteps: ReadonlySet<string>;
  /** When the chat gained a plan this sitting (quick → single/phased), for
   *  the rail's slide-in. Null when it opened with one, or never got one. */
  planArrivedAt: number | null;
}

interface Tracker {
  chat: string | null;
  title: TitleTrack;
  floor: Layout;
  upcoming: readonly string[];
  stages: readonly string[];
  stepCount: number;
  /** Steps begun so far: the finished ones plus the one in progress. */
  started: number;
  added: Set<string>;
  notes: PlanNote[];
  planArrivedAt: number | null;
}

export function usePhaseView(): LivePhaseView {
  const chat = useSession((s) => s.sessionId);
  const stages = useSession((s) => s.stages);
  const stageIndex = useSession((s) => s.stageIndex);
  const stepLog = useSession((s) => s.stepLog);
  const currentInstruction = useSession((s) => s.currentInstruction);
  const upcomingSteps = useSession((s) => s.upcomingSteps);
  const conversation = useSession((s) => s.conversation);
  const done = useSession((s) => s.done);

  const ref = useRef<Tracker | null>(null);
  const input = { stages, stageIndex, stepLog, currentInstruction, upcomingSteps, conversation, done };

  const started = stepLog.length + (currentInstruction.trim() && !done ? 1 : 0);

  // Updated during render on purpose: every step is a comparison against the
  // last snapshot, so running it twice with the same input changes nothing.
  let t = ref.current;
  if (!t || t.chat !== chat) {
    // A chat was opened or started: take its state as the baseline, with no
    // plan changes to report.
    t = {
      chat,
      title: { stepCount: stepLog.length, upcoming: [...upcomingSteps], title: "" },
      floor: layoutOf(input),
      upcoming: upcomingSteps,
      stages,
      stepCount: stepLog.length,
      started,
      added: new Set(),
      notes: [],
      planArrivedAt: null,
    };
    ref.current = t;
  } else if (t.upcoming !== upcomingSteps || t.stages !== stages || t.stepCount !== stepLog.length) {
    const newlyCompleted = stepLog.slice(t.stepCount).map((e) => e.text);
    const diff = diffPlan(
      { upcomingSteps: t.upcoming, stages: t.stages },
      { upcomingSteps, stages },
      newlyCompleted,
      Math.max(0, started - t.started),
    );
    const now = Date.now();
    const step = stepLog.length + (done ? 0 : 1);
    for (const s of diff.added) t.added.add(s.trim().toLowerCase());
    if (diff.notes.length > 0) {
      t.notes = [...t.notes, ...diff.notes.map((text) => ({ text, step, at: now }))];
    }
    t.title = trackCurrentTitle(t.title, { stepLog, upcomingSteps });
    t.upcoming = upcomingSteps;
    t.stages = stages;
    t.stepCount = stepLog.length;
    t.started = started;
  } else {
    // Nothing about the plan moved; keep the count current so a later turn
    // measures only its own new step.
    t.started = started;
  }
  const nextFloor = stickyLayout(layoutOf(input), t.floor);
  if (t.floor === "quick" && nextFloor !== "quick") {
    // A quick question turned into a walkthrough (SPEC §6.1): say so.
    const now = Date.now();
    const known = stepLog.length + (currentInstruction.trim() && !done ? 1 : 0) + upcomingSteps.length;
    const text = nextFloor === "phased" ? `Plan: ${stages.length} phases` : `Plan: ${known} steps`;
    t.notes = [...t.notes, { text, step: stepLog.length + (done ? 0 : 1), at: now }];
    t.planArrivedAt = now;
  }
  t.floor = nextFloor;

  const view = buildPhaseView(input, {
    currentTitle: t.title.title,
    addedSteps: t.added,
    layoutFloor: t.floor,
  });
  return { view, notes: t.notes, addedSteps: t.added, planArrivedAt: t.planArrivedAt };
}
