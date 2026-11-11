import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useTokens } from "../design/ThemeProvider";

interface Props {
  code: string;
  // The pre-redesign screen's look, for its two remaining callers
  // (Instruction, ConversationHistory) until WP8 removes them.
  legacy?: boolean;
  // Legacy only: the voice card is dark ink; history bubbles are light.
  onDark?: boolean;
}

/**
 * Copyable code the coach handed over. Rendered with line breaks and
 * indentation intact, with a Copy button — selecting it by hand collapsed a
 * whole YAML file into one line.
 */
export function CodeBlock({ code, legacy = false, onDark = false }: Props) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const tokens = useTokens();

  useEffect(() => {
    if (copied === "idle") return;
    const id = window.setTimeout(() => setCopied("idle"), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const fg = onDark ? "#F4F1E8" : "#1f2418";
  const dim = onDark ? "rgba(244,241,232,0.55)" : "rgba(31,36,24,0.55)";
  const bg = onDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.05)";
  const border = onDark ? "rgba(244,241,232,0.14)" : "rgba(0,0,0,0.1)";

  async function copy() {
    try {
      const ok = await api().clipboard.write(code);
      setCopied(ok ? "done" : "failed");
    } catch {
      setCopied("failed");
    }
  }

  const label = copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy";

  if (!legacy) {
    // Redesign (SPEC §4.5): code on the palette's code surface with a solid
    // Copy button beside it. A long line scrolls sideways inside the block;
    // the panel never scrolls sideways.
    const t = tokens.palette;
    return (
      <div
        className="no-drag"
        style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "4px 4px 4px 12px", borderRadius: tokens.radius.code,
          background: t.code, border: `1px solid ${t.line}`, minWidth: 0,
        }}
      >
        <pre
          className="sl-selectable"
          style={{
            flex: 1, minWidth: 0, margin: 0, padding: "7px 0",
            maxHeight: 260, overflow: "auto",
            fontFamily: tokens.font.mono, fontSize: 13, lineHeight: 1.45,
            color: t.ink, whiteSpace: "pre", tabSize: 2,
          }}
        >
          {code}
        </pre>
        <button
          type="button"
          className="sl-focus"
          onClick={() => void copy()}
          aria-live="polite"
          style={{
            flexShrink: 0, border: 0, borderRadius: 8, minHeight: 34, padding: "0 12px",
            background: t.btn, color: t.btnInk, fontSize: 12, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      </div>
    );
  }

  return (
    <div
      className="no-drag"
      style={{
        marginTop: 10, borderRadius: 9, border: `1px solid ${border}`,
        background: bg, overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "5px 8px 5px 10px", borderBottom: `1px solid ${border}`,
          fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase", color: dim,
        }}
      >
        <span>Paste this</span>
        <button
          type="button"
          onClick={() => void copy()}
          style={{
            border: `1px solid ${border}`, borderRadius: 6, padding: "3px 9px",
            background: "transparent", color: fg, fontSize: 11, fontWeight: 600,
            letterSpacing: "0.02em", cursor: "pointer",
          }}
        >
          {label}
        </button>
      </div>
      <pre
        className="sl-selectable"
        style={{
          margin: 0, padding: "9px 10px", maxHeight: 260, overflow: "auto",
          fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11.5,
          lineHeight: 1.5, color: fg, whiteSpace: "pre", tabSize: 2,
        }}
      >
        {code}
      </pre>
    </div>
  );
}
