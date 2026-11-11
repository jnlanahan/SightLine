// A step inside a phase chat (SPEC §4.5): a 20 px circle, "Step n · title",
// an "Added" tag for a step the coach put into the plan this sitting, and the
// step's messages indented under the label.

import type { ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { IconCheck } from "../../design/lineIcons";
import type { StepVM } from "../../lib/phaseView";

export function stepLabel(step: Pick<StepVM, "n" | "title">): string {
  return step.title ? `Step ${step.n} · ${step.title}` : `Step ${step.n}`;
}

export function StepCheckpoint({ step, children }: { step: StepVM; children?: ReactNode }) {
  const { palette: t, size, type } = useTokens();
  const current = step.state === "current";
  const d = size.circle.step;
  return (
    <div data-step={step.n} style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            width: d, height: d, flexShrink: 0, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: current ? t.accent : t.doneFill,
            color: current ? t.onAccent : t.doneInk,
            fontSize: 11, fontWeight: 700,
          }}
        >
          {current ? step.n : <IconCheck size={11} stroke={3} />}
        </span>
        <span
          style={{
            fontSize: type.label[0],
            fontWeight: current ? 700 : 600,
            lineHeight: type.label[2],
            color: current ? t.ink : t.ink2,
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          <span className="sl-sr-only">{current ? "Current: " : "Done: "}</span>
          {stepLabel(step)}
        </span>
        {step.added && (
          <span
            style={{
              flexShrink: 0,
              fontSize: type.tag[0], fontWeight: type.tag[1], letterSpacing: type.tag[3],
              textTransform: "uppercase", color: t.ink,
              border: `1px solid ${t.accent}`, borderRadius: 999, padding: "1px 7px",
            }}
          >
            Added
          </span>
        )}
      </div>
      {children ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: size.stepIndent }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
