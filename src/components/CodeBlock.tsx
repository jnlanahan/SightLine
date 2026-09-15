import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Props {
  code: string;
  // The voice card is dark ink; history bubbles are light. Pick the palette.
  onDark?: boolean;
}

/**
 * Copyable code the coach handed over. Rendered with line breaks and
 * indentation intact, with a Copy button — selecting it by hand collapsed a
 * whole YAML file into one line.
 */
export function CodeBlock({ code, onDark = false }: Props) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

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
          {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy"}
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
