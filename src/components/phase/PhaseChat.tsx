// The phase chat (SPEC §4.2, §5, §6.6): every phase section from the first to
// the current one, in one scroll, then the completion section once the goal
// is reached. Upcoming phases are not rendered — they live on the rail.
//
// Renders the view model only; it owns no scrolling decisions. The scroll
// container's ref is handed back so useFollowCurrent (WP5) can measure and
// move it, and sections and steps carry data-phase / data-step for that.

import type { ReactNode, Ref, UIEventHandler } from "react";
import { Fragment } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { IconCheck } from "../../design/lineIcons";
import type { ConversationTurn } from "../../../electron/types";
import {
  COMPLETION_BODY,
  completionHeadline,
  goalTurnText,
  type PhaseView,
  type StepVM,
} from "../../lib/phaseView";
import type { PlanNote } from "../../hooks/usePhaseView";
import { LeadLine } from "./LeadLine";
import { CoachText, PlanNoteBox, ResumeDivider, UserBubble } from "./Message";
import { PhaseSection } from "./PhaseSection";
import { StepCheckpoint } from "./StepCheckpoint";

export interface PhaseChatProps {
  view: PhaseView;
  /** The coach's state word for the current phase's eyebrow (SPEC §7). */
  stateWord: string;
  currentInstruction: string;
  currentCode?: string;
  /** Plan changes seen this sitting, each shown under its step. */
  notes?: readonly PlanNote[];
  /** The goal waiting on a yes (plan, "The redesign" item 1). While set, the
   *  current section shows it at lead size instead of an instruction. */
  pendingGoal?: { goal: string; doneWhen: string } | null;
  /** The resume divider, under the step that was current when reopened. */
  resume?: { step: number; at: number; text: string } | null;
  banner?: ReactNode;
  footer?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  /** The user reached for the scroll (wheel, touch, key, press), so the
   *  scroll events that follow are theirs and not the browser's or ours. */
  onUserScroll?: () => void;
}

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);

type Item =
  | { kind: "turn"; at: number; turn: ConversationTurn; lead: boolean }
  | { kind: "note"; at: number; text: string }
  | { kind: "divider"; at: number; text: string };

/** A step's messages, notes and divider in time order. */
function stepItems(step: StepVM, props: PhaseChatProps, hideGoal: boolean, quick: boolean): Item[] {
  const items: Item[] = [];
  // A quick answer usually arrives as plain words with no instruction set, so
  // nothing matches as the lead. Its first answer is the large line all the
  // same (SPEC §5); follow-ups after it stay at body size.
  const quickLead =
    quick && step.leadIndex === null && !props.currentInstruction.trim()
      ? step.turns.findIndex((t) => t.role === "assistant")
      : -1;
  step.turns.forEach((turn, i) => {
    if (hideGoal && goalTurnText(turn) !== null) return;
    items.push({
      kind: "turn",
      at: turn.timestamp,
      turn,
      lead: (step.isLeadHolder && i === step.leadIndex) || i === quickLead,
    });
  });
  for (const n of props.notes ?? []) {
    if (n.step === step.n) items.push({ kind: "note", at: n.at, text: n.text });
  }
  if (props.resume && props.resume.step === step.n) {
    items.push({ kind: "divider", at: props.resume.at, text: props.resume.text });
  }
  // Stable sort: ties keep turns before notes before the divider.
  return items.map((it, i) => ({ it, i })).sort((a, b) => a.it.at - b.it.at || a.i - b.i).map((x) => x.it);
}

function renderItem(item: Item, key: number, past: boolean, code?: string): ReactNode {
  if (item.kind === "note") return <PlanNoteBox key={key} text={item.text} />;
  if (item.kind === "divider") return <ResumeDivider key={key} text={item.text} />;
  const { turn } = item;
  if (turn.role === "user") {
    return <UserBubble key={key} text={goalTurnText(turn) ?? turn.content} />;
  }
  if (item.lead) return <LeadLine key={key} text={turn.content} code={code || turn.code} />;
  return <CoachText key={key} text={turn.content} code={turn.code} past={past} />;
}

function StepMessages({ step, props, past, hideGoal, quick = false }: { step: StepVM; props: PhaseChatProps; past: boolean; hideGoal: boolean; quick?: boolean }) {
  const items = stepItems(step, props, hideGoal, quick);
  const nodes = items.map((it, i) => renderItem(it, i, past, props.currentCode));
  // The current step always shows its instruction once, large — even when the
  // transcript has no matching line (a reopened chat, a digression).
  if (step.isLeadHolder && step.leadIndex === null && props.currentInstruction.trim() && !props.pendingGoal) {
    nodes.push(<LeadLine key="lead" text={props.currentInstruction} code={props.currentCode} />);
  }
  return <>{nodes}</>;
}

function GoalWaiting({ goal, doneWhen }: { goal: string; doneWhen: string }) {
  const { palette: t, type } = useTokens();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <LeadLine text={goal} />
      {doneWhen ? (
        <p className="sl-selectable" style={{ margin: 0, fontSize: type.body[0], lineHeight: type.body[2], color: t.ink2 }}>
          Done when: {doneWhen}
        </p>
      ) : null}
    </div>
  );
}

export function PhaseChat(props: PhaseChatProps) {
  const { view } = props;
  const { palette: t, type } = useTokens();
  const phased = view.layout === "phased";
  const quick = view.layout === "quick";
  const N = view.phases.length;
  const lastTurns = view.phases.flatMap((p) => p.steps.flatMap((s) => s.turns));
  const lastCoach = [...lastTurns].reverse().find((x) => x.role === "assistant")?.content;

  return (
    <div
      ref={props.scrollRef}
      onScroll={props.onScroll}
      onWheel={props.onUserScroll}
      onTouchMove={props.onUserScroll}
      // Only the keys that scroll, and only a press on the scroller's own box
      // (its scrollbar). A tap on "I did it" is inside this element too, and
      // is not the user scrolling.
      onKeyDown={(e) => {
        if (SCROLL_KEYS.has(e.key)) props.onUserScroll?.();
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onUserScroll?.();
      }}
      className="sl-scroll"
      style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", position: "relative" }}
    >
      {view.phases.map((phase, i) => {
        if (phase.state === "upcoming") return null;
        // A quick answer's one section stays the live card even when done:
        // it has no plan to complete (SPEC §5).
        const current = phase.state === "current" || quick;
        const past = !current;
        return (
          <PhaseSection
            key={i}
            index={i}
            eyebrow={phased ? `Phase ${i + 1} of ${N}` : undefined}
            title={phase.title}
            current={current}
            stateWord={current ? props.stateWord : undefined}
            banner={current ? props.banner : undefined}
            footer={current ? props.footer : undefined}
            bare={quick}
          >
            {current && props.pendingGoal ? (
              <GoalWaiting goal={props.pendingGoal.goal} doneWhen={props.pendingGoal.doneWhen} />
            ) : null}
            {phase.steps
              .filter((s) => s.state !== "upcoming")
              .map((step) =>
                quick ? (
                  // A quick answer has no checkpoints: the messages sit
                  // straight in the section (SPEC §5).
                  <Fragment key={step.n}>
                    <StepMessages step={step} props={props} past={past} hideGoal={false} quick />
                  </Fragment>
                ) : (
                  <StepCheckpoint key={step.n} step={step}>
                    <StepMessages step={step} props={props} past={past} hideGoal />
                  </StepCheckpoint>
                ),
              )}
          </PhaseSection>
        );
      })}

      {view.done && !quick ? (
        <section
          data-phase={N}
          aria-label="Goal reached"
          style={{
            minHeight: "100%",
            boxSizing: "border-box",
            padding: "40px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            background: t.card,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 44, height: 44, borderRadius: "50%", background: t.accent, color: t.onAccent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <IconCheck size={20} stroke={3} />
          </span>
          <div style={{ fontSize: type.headline[0], fontWeight: type.headline[1], lineHeight: type.headline[2], color: t.ink }}>
            {completionHeadline(lastCoach)}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: t.ink2 }}>{COMPLETION_BODY}</p>
          {props.footer ?? null}
        </section>
      ) : null}
    </div>
  );
}
