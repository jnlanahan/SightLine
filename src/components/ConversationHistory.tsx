import { useEffect, useRef } from "react";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import { CodeBlock } from "./CodeBlock";
import type { ConversationTurn } from "../../electron/types";

interface Props {
  turns: ConversationTurn[];
  // The current instruction renders as a distinguished "voice card" BELOW
  // this list (see App.tsx) — hide the trailing assistant turn that carries
  // the same text so it isn't shown twice.
  hideLatestAssistant?: string;
  // App owns the scroll anchor when the list is composed with other elements.
  autoScroll?: boolean;
}

export function ConversationHistory({
  turns,
  hideLatestAssistant,
  autoScroll = true,
}: Props) {
  const T = useTheme();
  const bottomRef = useRef<HTMLDivElement>(null);

  let visible = turns.filter(
    (t) => !(t.role === "user" && t.content.startsWith("Goal:")),
  );
  if (hideLatestAssistant && visible.length > 0) {
    const last = visible[visible.length - 1];
    if (last.role === "assistant" && last.content === hideLatestAssistant) {
      visible = visible.slice(0, -1);
    }
  }

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length, autoScroll]);

  if (visible.length === 0) return null;

  return (
    <div className="sl-selectable" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {visible.map((turn, i) => {
        const isUser = turn.role === "user";
        return (
          <div
            key={i}
            style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}
          >
            <div
              style={{
                maxWidth: "85%", padding: "9px 13px",
                fontSize: 13, lineHeight: 1.5,
                ...(isUser
                  ? {
                      background: `linear-gradient(180deg, ${T.accent} 0%, ${T.accentDeep} 100%)`,
                      color: T.onAccent,
                      borderRadius: "14px 14px 4px 14px",
                    }
                  : {
                      background: lt(0.05),
                      color: T.ink,
                      border: `1px solid ${lt(0.08)}`,
                      borderRadius: "14px 14px 14px 4px",
                    }),
              }}
            >
              {turn.content}
              {turn.code && <CodeBlock code={turn.code} />}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
