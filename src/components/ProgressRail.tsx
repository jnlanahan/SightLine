import { Fragment } from "react";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import { IChevron } from "../design/icons";
import { clockTime, dayLabel } from "../lib/when";

export interface PlanStep {
  description: string;
  state: "completed" | "current" | "upcoming";
  // When a completed step was done, from the chat's step log.
  at?: number;
  // The stage of a long plan it belonged to, by title.
  stage?: string;
}

interface Props {
  label: string;
  goal: string;
  steps: PlanStep[];
  open: boolean;
  docked: boolean;
  onToggle(): void;
}

/**
 * The always-visible progress header.
 *
 * Two jobs: say where you are in one glance ("Step 3 of 7", a filled bar), and
 * act as the toggle for the full plan. Deliberately compact — it sits above
 * the conversation permanently, so every pixel it takes is a pixel of chat.
 */
export function ProgressRail({ label, goal, steps, open, docked, onToggle }: Props) {
  const T = useTheme();
  const total = steps.length;
  const done = steps.filter((s) => s.state === "completed").length;
  const hasCurrent = steps.some((s) => s.state === "current");
  // The step the user is on is the one after everything completed. Clamped so
  // a finished plan reads "7 of 7" rather than "8 of 7".
  const position = Math.min(done + (hasCurrent ? 1 : 0), total);
  const pct = total > 0 ? (done / total) * 100 : 0;

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: `1px solid ${lt(0.08)}`,
        background: open ? lt(0.04) : "transparent",
      }}
    >
      <button
        type="button"
        className="no-drag"
        onClick={onToggle}
        title={open ? "Hide the steps" : "Show all steps"}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          textAlign: "left",
          padding: docked ? "10px 14px 8px" : "8px 14px 7px",
          border: 0,
          background: "transparent",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 3,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: T.ink3,
                flexShrink: 0,
              }}
            >
              {label}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                color: T.ink2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={goal}
            >
              {goal}
            </span>
          </div>
          {total > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                aria-hidden
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 5,
                  background: lt(0.09),
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: 5,
                    background: `linear-gradient(90deg, ${T.accent}, ${T.accentDeep})`,
                    transition: "width 450ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: T.accentText,
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {position} / {total}
              </span>
            </div>
          )}
        </div>
        <span
          aria-hidden
          style={{
            color: T.ink3,
            flexShrink: 0,
            display: "inline-flex",
            transform: open ? "rotate(-90deg)" : "rotate(90deg)",
            transition: "transform 180ms",
          }}
        >
          <IChevron />
        </span>
      </button>
    </div>
  );
}

/**
 * The expanded step list.
 *
 * Rendered INLINE, in the normal flex flow — never absolutely positioned over
 * the conversation. It takes a bounded slice of the panel and scrolls inside
 * it, so opening the plan shrinks the chat rather than hiding it. (The
 * previous drawer floated on top and buried the coach's messages.)
 */
export function PlanList({ steps }: { steps: PlanStep[] }) {
  const T = useTheme();
  const now = Date.now();
  if (steps.length === 0) {
    return (
      <div
        className="sl-scroll"
        style={{
          flexShrink: 0,
          padding: "10px 16px 12px",
          fontSize: 12,
          color: T.ink3,
          borderBottom: `1px solid ${lt(0.08)}`,
        }}
      >
        The plan will appear here once the coach has looked at your screen.
      </div>
    );
  }

  return (
    <ol
      className="sl-scroll sl-selectable"
      style={{
        flexShrink: 1,
        // Bounded so a long plan can never squeeze the conversation out of
        // existence; scrolls within its own box.
        maxHeight: "34vh",
        overflowY: "auto",
        margin: 0,
        padding: "8px 16px 12px",
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        borderBottom: `1px solid ${lt(0.08)}`,
      }}
    >
      {steps.map((step, i) => {
        // The step log: each finished step carries its time, and a day
        // heading marks where one sitting's work ends and the next begins.
        const day = step.at !== undefined ? dayLabel(step.at, now) : null;
        const prevAt = steps[i - 1]?.at;
        const newDay =
          day !== null && (prevAt === undefined || dayLabel(prevAt, now) !== day);
        // In a long plan, mark where each stage's steps begin.
        const newStage = Boolean(step.stage) && steps[i - 1]?.stage !== step.stage;
        return (
          <Fragment key={`${step.state}-${i}`}>
            {newDay && (
              <li
                style={{
                  padding: i === 0 ? "0 0 2px" : "8px 0 2px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: T.ink3,
                }}
              >
                {day}
              </li>
            )}
            {newStage && (
              <li
                style={{
                  padding: "4px 0 1px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.ink2,
                }}
              >
                {step.stage}
              </li>
            )}
            <li
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                padding: "5px 0",
              }}
            >
              <StepMarker state={step.state} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color:
                    step.state === "current"
                      ? T.ink
                      : step.state === "completed"
                        ? T.ink3
                        : T.ink2,
                  fontWeight: step.state === "current" ? 600 : 400,
                  textDecoration: step.state === "completed" ? "line-through" : "none",
                  opacity: step.state === "upcoming" ? 0.75 : 1,
                }}
              >
                {step.description}
              </span>
              {step.at !== undefined && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10.5,
                    lineHeight: 1.6,
                    color: T.ink3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {clockTime(step.at)}
                </span>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * The stages of a long plan, above the step list: which are done, which one
 * the user is on, and what is still to come. Renders nothing for a chat
 * without stages.
 */
export function StageList({ stages, current }: { stages: string[]; current: number }) {
  const T = useTheme();
  if (stages.length === 0) return null;
  return (
    <ol
      className="sl-selectable"
      style={{
        flexShrink: 0,
        margin: 0,
        padding: "8px 16px 6px",
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        borderBottom: `1px solid ${lt(0.08)}`,
      }}
    >
      {stages.map((title, i) => {
        const state: PlanStep["state"] =
          i < current ? "completed" : i === current ? "current" : "upcoming";
        return (
          <li
            key={`${i}-${title}`}
            style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "3px 0" }}
          >
            <StepMarker state={state} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                lineHeight: 1.45,
                color: state === "current" ? T.ink : state === "completed" ? T.ink3 : T.ink2,
                fontWeight: state === "current" ? 600 : 400,
                opacity: state === "upcoming" ? 0.75 : 1,
              }}
            >
              {i + 1}. {title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepMarker({ state }: { state: PlanStep["state"] }) {
  const T = useTheme();
  const base: React.CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    marginTop: 2,
  };

  if (state === "completed") {
    return (
      <span style={{ ...base, background: ar(T.greenRGB, 0.18), color: T.green }}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2 6l3 3 5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (state === "current") {
    return (
      <span
        style={{
          ...base,
          border: `2px solid ${T.accentDeep}`,
          background: ar(T.accentRGB, 0.16),
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: T.accentDeep,
            animation: "sl-live-pulse 2s ease-out infinite",
          }}
        />
      </span>
    );
  }

  return <span style={{ ...base, border: `1.5px solid ${lt(0.2)}` }} />;
}
