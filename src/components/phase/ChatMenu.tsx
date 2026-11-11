// The "⋯" menu (plan, "The redesign: phase chats", item 3). The new screen
// has room for a rail and one menu button, so everything that otherwise has
// no home lives here: About this chat, attach, see what the coach sees, the
// watched area and screen, dock or float, Settings, what this sitting has
// cost, minimize and quit. A plain list, restyled with the tokens; its layout
// is not designed yet.

import { useEffect, useRef, type ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { useSession } from "../../store/session";
import { useSettings } from "../../store/settings";
import { budgetStatus, formatUsd } from "../../../electron/usage";
import { ScreenPicker } from "../ScreenPicker";

export interface ChatMenuProps {
  docked: boolean;
  aboutOpen: boolean;
  attachedCount: number;
  canPeek: boolean;
  onClose(): void;
  onAbout(): void;
  onAttach(): void;
  onPeek(): void;
  onAdjustArea(): void;
  onToggleDock(): void;
  onSettings(): void;
  onMinimize(): void;
  onQuit(): void;
}

/** "So far this sitting: $0.12 of $3.00" — the spend line that used to be
 *  always on screen (plan item 4). */
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

  const item = (label: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}): ReactNode => (
    <button
      type="button"
      role="menuitem"
      className="sl-focus no-drag"
      disabled={opts.disabled}
      onClick={() => {
        p.onClose();
        onClick();
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

  return (
    <>
      {/* Click anywhere else to close. */}
      <div aria-hidden="true" onClick={p.onClose} style={{ position: "absolute", inset: 0, zIndex: 19 }} />
      <div
        ref={listRef}
        role="menu"
        aria-label="Menu"
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
        {item(p.aboutOpen ? "Back to the chat" : "About this chat", p.onAbout)}
        {item(p.attachedCount > 0 ? `Attach a file (${p.attachedCount} attached)` : "Attach a file", p.onAttach)}
        {item("See what the coach sees", p.onPeek, { disabled: !p.canPeek })}
        {item("Choose the area it watches", p.onAdjustArea)}
        {/* Switch screen: the picker shows itself only with two or more. */}
        <div style={{ padding: "4px 8px" }}>
          <ScreenPicker compact />
        </div>
        {item(p.docked ? "Float the window" : "Dock to the side", p.onToggleDock)}
        {item("Settings", p.onSettings)}
        {rule}
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
        {item("Minimize", p.onMinimize)}
        {item("Quit", p.onQuit)}
      </div>
    </>
  );
}
