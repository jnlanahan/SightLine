// "Needs you" (SPEC §7): what is wrong in plain words, and at most one action.
// Sits at the top of the current phase section.

import { useTokens } from "../../design/ThemeProvider";

export function NeedsYouBanner({
  message,
  detail,
  action,
}: {
  message: string;
  /** The underlying error, as a tooltip only. */
  detail?: string;
  action?: { label: string; onClick(): void } | null;
}) {
  const { palette: t, radius } = useTokens();
  return (
    <div
      role="alert"
      style={{
        borderRadius: radius.banner,
        padding: "12px 14px",
        border: `1px solid ${t.warn}`,
        background: t.warnSoft,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <div className="sl-selectable" title={detail} style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45, color: t.ink }}>
        {message}
      </div>
      {action ? (
        <button
          type="button"
          className="sl-focus no-drag"
          onClick={action.onClick}
          style={{
            height: 38,
            borderRadius: 999,
            border: `1px solid ${t.chip}`,
            background: "transparent",
            color: t.ink,
            fontSize: 13,
            fontWeight: 600,
            padding: "0 14px",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
