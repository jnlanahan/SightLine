// The Udemy-style curriculum browser: each module is a collapsible row that
// drops down to its tasks. One component, two homes — the plan review screen
// at creation time and the in-session sidebar (it replaces PlanList when a
// training plan is active; tech support keeps the flat list).

import { useState } from "react";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import type { TrainingModule, TrainingPlan, TrainingTask } from "../lib/api";

interface Props {
  plan: TrainingPlan;
  // Review screen wants everything visible; the sidebar starts with only the
  // current module open.
  expandAll?: boolean;
}

type TaskGlyph = "done" | "current" | "todo";

function taskGlyph(
  plan: TrainingPlan,
  mi: number,
  ti: number,
  task: TrainingTask,
): TaskGlyph {
  if (task.status === "completed") return "done";
  if (plan.cursor.module === mi && plan.cursor.task === ti) return "current";
  return "todo";
}

export function CurriculumOutline({ plan, expandAll = false }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const isOpen = (m: TrainingModule, mi: number) =>
    open[m.id] ?? (expandAll || mi === plan.cursor.module);

  return (
    <div
      className="sl-scroll no-drag"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflowY: "auto",
        maxHeight: expandAll ? undefined : "38vh",
        paddingRight: 2,
      }}
    >
      {plan.modules.map((m, mi) => (
        <ModuleRow
          key={m.id}
          plan={plan}
          module={m}
          mi={mi}
          open={isOpen(m, mi)}
          onToggle={() => setOpen((o) => ({ ...o, [m.id]: !isOpen(m, mi) }))}
        />
      ))}
    </div>
  );
}

function ModuleRow({
  plan,
  module,
  mi,
  open,
  onToggle,
}: {
  plan: TrainingPlan;
  module: TrainingModule;
  mi: number;
  open: boolean;
  onToggle(): void;
}) {
  const T = useTheme();
  const doneCount = module.tasks.filter((t) => t.status === "completed").length;
  const isCurrent = mi === plan.cursor.module;
  const completed = module.status === "completed";

  return (
    <div
      style={{
        borderRadius: 11,
        border: `1px solid ${isCurrent ? ar(T.accentRGB, 0.35) : lt(0.08)}`,
        background: isCurrent ? ar(T.accentRGB, 0.05) : lt(0.025),
        overflow: "hidden",
        // In a column flexbox, overflow:hidden lets min-height collapse to 0,
        // so the rows were SHRUNK to fit the 38vh box instead of scrolling
        // inside it — in a short floating window each module became a
        // sliver with one visible task. Rows keep their size; the list scrolls.
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 11px",
          border: 0,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: T.ink,
          fontFamily: "inherit",
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 9,
            color: T.ink3,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 140ms",
            flexShrink: 0,
          }}
        >
          ▶
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 650,
            color: completed ? T.ink3 : T.ink,
            textDecoration: completed ? "line-through" : "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {mi + 1}. {module.title}
        </span>
        <span
          style={{
            fontSize: 10,
            fontVariantNumeric: "tabular-nums",
            color: completed ? T.green : T.ink3,
            flexShrink: 0,
          }}
        >
          {doneCount}/{module.tasks.length}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 11px 9px 28px", display: "flex", flexDirection: "column", gap: 5 }}>
          {module.summary && (
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: T.ink3 }}>
              {module.summary}
            </p>
          )}
          {module.tasks.map((t, ti) => {
            const glyph = taskGlyph(plan, mi, ti, t);
            return (
              <div key={t.id} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    flexShrink: 0,
                    textAlign: "center",
                    fontSize: 10,
                    lineHeight: "17px",
                    color:
                      glyph === "done" ? T.green : glyph === "current" ? T.accentText : T.ink3,
                  }}
                >
                  {glyph === "done" ? "✓" : glyph === "current" ? "▶" : "○"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.4,
                      color: glyph === "done" ? T.ink3 : T.ink2,
                      fontWeight: glyph === "current" ? 600 : 400,
                    }}
                  >
                    {t.title}
                  </div>
                  {glyph === "current" && t.objective && (
                    <div style={{ marginTop: 2, fontSize: 11, lineHeight: 1.45, color: T.ink3 }}>
                      {t.objective}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!module.detailed && (
            <p style={{ margin: 0, fontSize: 10, fontStyle: "italic", color: T.ink3 }}>
              Outlined — details are written when you get here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
