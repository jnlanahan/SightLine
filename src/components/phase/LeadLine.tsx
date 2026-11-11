// The lead line (SPEC §4.5, D8): the current step's instruction, set large
// enough to read at a glance from the other program. Exactly one on screen.
// It types in as it is spoken (today's typewriter, capped as before) and is
// announced politely to screen readers.

import { useEffect, useRef, useState } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { CodeBlock } from "../CodeBlock";

// Soft typewriter reveal — caps at ~60 frames so longer lines don't drag,
// and skips animation for unchanged text. (Moved from the old Instruction card.)
function useTypewriter(text: string): string {
  const [shown, setShown] = useState(text);
  const lastRef = useRef(text);

  useEffect(() => {
    if (text === lastRef.current) return;
    lastRef.current = text;
    if (!text) { setShown(""); return; }
    let i = 0;
    setShown("");
    const stepSize = Math.max(2, Math.ceil(text.length / 60));
    const id = window.setInterval(() => {
      i += stepSize;
      if (i >= text.length) {
        setShown(text);
        window.clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, 16);
    return () => window.clearInterval(id);
  }, [text]);

  return shown;
}

export function LeadLine({ text, code }: { text: string; code?: string }) {
  const { palette: t, type } = useTokens();
  const shown = useTypewriter(text);
  const [size, weight, lh, track] = type.lead;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p
        className="sl-selectable"
        aria-live="polite"
        data-lead-line=""
        style={{
          margin: 0,
          fontSize: size,
          fontWeight: weight,
          lineHeight: lh,
          letterSpacing: track,
          color: t.ink,
          overflowWrap: "anywhere",
        }}
      >
        {shown}
        {shown.length < text.length && (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block", width: 2, marginLeft: 2, height: "0.9em",
              background: t.accent, verticalAlign: "text-bottom",
              animation: "sl-blink 1.6s ease-in-out infinite",
            }}
          />
        )}
      </p>
      {code ? <CodeBlock code={code} /> : null}
    </div>
  );
}
