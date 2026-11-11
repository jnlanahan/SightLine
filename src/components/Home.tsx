import { useEffect, useRef, useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { api } from "../lib/api";
import type { ChatSummary } from "../lib/api";
import { markAsk } from "../lib/askClock";
import { timeAgo } from "../lib/when";
import { useTheme } from "../design/ThemeProvider";
import { Eyebrow } from "../design/primitives";
import { ar, lt } from "../design/theme";
import { ScreenPicker } from "./ScreenPicker";
import { ModelCaption } from "./ModelCaption";

interface Props {
  onStart(goal: string): void;
  onOpen(chatId: string): void;
}

/**
 * The one front door: say what you want and the coach starts, or pick up a
 * chat where you left it. No mode to choose and no setup questions — the
 * coach's first look at the goal and the screen decides how to help.
 */
export function Home({ onStart, onOpen }: Props) {
  const T = useTheme();
  const [value, setValue] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  // The chat whose delete button was pressed — deleting takes a second tap.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const voice = useVoice((text) =>
    setValue((prev) => (prev ? `${prev} ${text}` : text)),
  );

  // Tidy-up runs here and only here: Home is where the user lands after
  // leaving a chat, and at launch after a quit. Once per visit, in the
  // background, for the couple of most recent chats that have moved on since
  // they were last tidied. The list is shown first and refreshed after.
  const tidied = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list: ChatSummary[] = [];
      try {
        list = await api().chats.list();
      } catch {
        // an empty list is the fallback
      }
      if (cancelled) return;
      setChats(list);
      if (tidied.current) return;
      tidied.current = true;
      let changed = false;
      for (const chat of list.filter((c) => c.needsTidy).slice(0, 2)) {
        try {
          const result = await api().chats.tidy(chat.id);
          changed = changed || result.tidied;
        } catch {
          // tidy-up is never load-bearing
        }
        if (cancelled) return;
      }
      if (!changed) return;
      try {
        const fresh = await api().chats.list();
        if (!cancelled) setChats(fresh);
      } catch {
        // keep the list already shown
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function start() {
    const goal = value.trim();
    if (!goal) return;
    markAsk("goal", Date.now());
    onStart(goal);
  }

  function deleteChat(id: string) {
    setConfirmingDelete(null);
    void api()
      .chats.delete(id)
      .then(() => api().chats.list())
      .then(setChats)
      .catch(() => undefined);
  }

  const now = Date.now();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Multi-monitor: pick the watched screen right here, in the flow —
          most users never open Settings. Renders nothing on single-screen. */}
      <ScreenPicker compact />

      <Eyebrow>What do you want to do?</Eyebrow>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            start();
          }
        }}
        rows={3}
        autoFocus
        placeholder={'e.g. "How do I freeze the top row?" or "Teach me pivot tables in Excel"'}
        className="sl-scroll no-drag"
        style={{
          width: "100%", border: `1px solid ${lt(0.10)}`,
          background: lt(0.04), borderRadius: 11,
          padding: "9px 12px", fontSize: 13.5, color: T.ink,
          outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          resize: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
          disabled={voice.state === "transcribing"}
          style={{
            borderRadius: 9, border: `1px solid ${lt(0.10)}`,
            background: voice.state === "recording" ? T.warnSoft : lt(0.04),
            color: voice.state === "recording" ? T.warn : T.ink2,
            fontSize: 12, fontWeight: 500, padding: "7px 14px",
            cursor: voice.state === "transcribing" ? "default" : "pointer",
            opacity: voice.state === "transcribing" ? 0.5 : 1,
          }}
        >
          {voice.state === "recording"
            ? "● Stop"
            : voice.state === "transcribing"
              ? "Transcribing…"
              : "🎤 Speak"}
        </button>
        {/* So the model is known before the chat starts, not only during it. */}
        <ModelCaption style={{ marginLeft: "auto" }} />
        <button
          type="button"
          onClick={start}
          disabled={value.trim().length === 0}
          style={{
            borderRadius: 9, border: 0,
            background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
            color: T.onAccent,
            fontSize: 12, fontWeight: 600, padding: "7px 20px",
            cursor: "pointer",
            opacity: value.trim().length === 0 ? 0.4 : 1,
            boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
            transition: "opacity 150ms",
          }}
        >
          Start
        </button>
      </div>
      {voice.error && (
        <p style={{ fontSize: 11, color: T.warn, margin: 0 }}>{voice.error}</p>
      )}

      {chats.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          <Eyebrow>Your chats</Eyebrow>
          {chats.map((chat) =>
            confirmingDelete === chat.id ? (
              <div
                key={chat.id}
                className="no-drag"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 12px", borderRadius: 11,
                  border: `1px solid ${T.warn}`,
                  background: T.warnSoft,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.ink2 }}>
                  Delete “{chat.title}” and everything in it?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(null)}
                  style={{
                    borderRadius: 8, border: `1px solid ${lt(0.12)}`,
                    background: "transparent", color: T.ink2,
                    fontSize: 11, padding: "5px 10px", cursor: "pointer", flexShrink: 0,
                  }}
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => deleteChat(chat.id)}
                  style={{
                    borderRadius: 8, border: 0,
                    background: T.warn, color: T.onWarn,
                    fontSize: 11, fontWeight: 600, padding: "5px 10px",
                    cursor: "pointer", flexShrink: 0,
                  }}
                >
                  Delete
                </button>
              </div>
            ) : (
              <div
                key={chat.id}
                className="no-drag"
                style={{
                  display: "flex", alignItems: "stretch",
                  borderRadius: 11, border: `1px solid ${lt(0.10)}`,
                  background: lt(0.04), overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(chat.id)}
                  title="Open this chat and carry on"
                  style={{
                    flex: 1, minWidth: 0, textAlign: "left",
                    display: "flex", flexDirection: "column", gap: 3,
                    padding: "9px 12px", border: 0, background: "transparent",
                    color: "inherit", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <span style={{
                    fontSize: 13, fontWeight: 600, color: T.ink,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {chat.title}
                  </span>
                  {chat.whereWeLeftOff && (
                    <span style={{
                      fontSize: 11.5, lineHeight: 1.4, color: T.ink2,
                      display: "-webkit-box", WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}>
                      {chat.whereWeLeftOff}
                    </span>
                  )}
                  <span style={{ fontSize: 10.5, color: T.ink3 }}>
                    {timeAgo(chat.lastActiveAt, now)}
                    {chat.stepsDone > 0 &&
                      ` · ${chat.stepsDone} step${chat.stepsDone === 1 ? "" : "s"} done`}
                    {chat.state === "done" && " · Finished"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(chat.id)}
                  title="Delete this chat"
                  aria-label={`Delete ${chat.title}`}
                  style={{
                    width: 32, flexShrink: 0, border: 0,
                    borderLeft: `1px solid ${lt(0.08)}`,
                    background: "transparent", color: T.ink3,
                    fontSize: 12, cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
