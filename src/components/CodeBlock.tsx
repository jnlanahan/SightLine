import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useTokens } from "../design/ThemeProvider";

interface Props {
  code: string;
}

/**
 * Copyable code the coach handed over. Rendered with line breaks and
 * indentation intact, with a Copy button — selecting it by hand collapsed a
 * whole YAML file into one line.
 *
 * Redesign (SPEC §4.5): code on the palette's code surface with a solid Copy
 * button beside it. A long line scrolls sideways inside the block; the panel
 * never scrolls sideways.
 */
export function CodeBlock({ code }: Props) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const { palette: t, font, radius } = useTokens();

  useEffect(() => {
    if (copied === "idle") return;
    const id = window.setTimeout(() => setCopied("idle"), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      const ok = await api().clipboard.write(code);
      setCopied(ok ? "done" : "failed");
    } catch {
      setCopied("failed");
    }
  }

  const label = copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy";

  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "4px 4px 4px 12px", borderRadius: radius.code,
        background: t.code, border: `1px solid ${t.line}`, minWidth: 0,
      }}
    >
      <pre
        className="sl-selectable"
        style={{
          flex: 1, minWidth: 0, margin: 0, padding: "7px 0",
          maxHeight: 260, overflow: "auto",
          fontFamily: font.mono, fontSize: 13, lineHeight: 1.45,
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
