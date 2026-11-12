// The "⋯" menu, on every screen.
//
// Two groups. The first exists only while a chat is open, and is about that
// chat: what the coach remembers in it, attaching a file, seeing what the
// coach sees, and what this sitting has cost. The second is always there and
// is about the window: collapse, dock or float, minimize, quit.
//
// Settings is not in here: it has its own button beside this one, in the same
// place on every screen. Choosing the watched screen or area is in Settings.

import { useEffect, useRef, type ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { useSession } from "../../store/session";
import { useSettings } from "../../store/settings";
import { budgetStatus, formatUsd } from "../../../electron/usage";

export interface ChatMenuProps {
  /** A chat is open: show the chat's own group. */
  inChat: boolean;
  docked: boolean;
  aboutOpen?: boolean;
  attachedCount?: number;
  canPeek?: boolean;
  onClose(): void;
  onAbout?(): void;
  onAttach?(): void;
  onPeek?(): void;
  onCollapse(): void;
  onToggleDock(): void;
  onMinimize(): void;
  onQuit(): void;
}

/** "So far this sitting: $0.12 of $3.00" — the spend line that used to be
 *  always on screen. */
export function costLine(costUsd: number, capUsd: number): string {
  const spent = formatUsd(costUsd);
  return capUsd > 0 ? `So far this sitting: ${spent} of ${formatUsd(capUsd)}` : `So far this sitting: ${spent}`;
}

export function ChatMenu(p: ChatMenuProps) {
  const { palette: t } = useTokens();
  const listRef = useRef<HTMLDivElement | null>(null);
  const costUsd = useSession((s) => s.costUsd);
  const cap = useSettings((s) => s.settings?.sessionBudgetUsd ?? 0);
  const budget = budgetStatus(costUsd, cap);

  // Focus the first item on open; Esc closes.
  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>("button[role='menuitem']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const item = (label: string, onClick: (() => void) | undefined, opts: { disabled?: boolean; hint?: string } = {}): ReactNode => (
    <button
      type="button"
      role="menuitem"
      className="sl-focus no-drag"
      disabled={opts.disabled}
      title={opts.hint}
      onClick={() => {
        p.onClose();
        onClick?.();
      }}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        minHeight: 40,
        padding: "0 14px",
        border: 0,
        borderRadius: 8,
        background: "transparent",
        color: opts.disabled ? t.muted : t.ink,
        fontSize: 13.5,
        cursor: opts.disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
  const rule = <div aria-hidden="true" style={{ height: 1, background: t.line, margin: "4px 6px" }} />;
  const heading = (text: string) => (
    <div
      aria-hidden="true"
      style={{ padding: "8px 14px 4px", fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: t.ink2 }}
    >
      {text}
    </div>
  );

  return (
    <>
      {/* Click anywhere else to close. */}
      <div aria-hidden="true" className="no-drag" onClick={p.onClose} style={{ position: "absolute", inset: 0, zIndex: 19 }} />
      <div
        ref={listRef}
        role="menu"
        aria-label="More options"
        className="no-drag"
        style={{
          position: "absolute",
          top: 56,
          right: 8,
          zIndex: 20,
          width: 260,
          maxWidth: "calc(100% - 16px)",
          maxHeight: "calc(100% - 72px)",
          overflowY: "auto",
          boxSizing: "border-box",
          padding: 6,
          background: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 12,
          boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
        }}
      >
        {p.inChat && (
          <>
            {heading("This chat")}
            {item(p.aboutOpen ? "Back to the chat" : "About this chat", p.onAbout)}
            {item(p.attachedCount ? `Attach a file (${p.attachedCount} attached)` : "Attach a file", p.onAttach)}
            {item("See what the coach sees", p.onPeek, {
              disabled: !p.canPeek,
              hint: p.canPeek ? undefined : "Nothing yet — the coach has not looked at your screen in this sitting",
            })}
            <div
              style={{
                padding: "8px 14px",
                fontSize: 12.5,
                color: budget.level === "ok" ? t.ink2 : t.warn,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {costLine(costUsd, cap)}
            </div>
            {rule}
            {heading("Window")}
          </>
        )}
        {item("Collapse", p.onCollapse)}
        {item(p.docked ? "Float the window" : "Dock to the side", p.onToggleDock)}
        {item("Minimize", p.onMinimize)}
        {item("Quit", p.onQuit)}
      </div>
    </>
  );
}
