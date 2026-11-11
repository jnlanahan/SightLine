import { useState } from "react";
import { useTheme } from "../design/ThemeProvider";
import { lt } from "../design/theme";
import type { ChatNote } from "../../electron/db/schema";

/**
 * About this chat: what the coach knows about the open chat, and the controls
 * for it. The goal, where things stand, the coach's notes — each marked as
 * seen on screen or not yet confirmed, and each editable or forgettable —
 * the attached files, mark done, and delete.
 *
 * Plain, in today's look. Every change goes through the live session store,
 * which is what autosave writes from, so an edit cannot be overwritten by the
 * next save.
 */
export function AboutChat({
  goal,
  whereWeLeftOff,
  tidyNote,
  notes,
  fileNames,
  done,
  onEditNote,
  onForgetNote,
  onMarkDone,
  onDelete,
  onClose,
}: {
  goal: string;
  whereWeLeftOff: string;
  // What the background tidy-up did after the last visit, in a sentence.
  // Empty when the chat has never been tidied.
  tidyNote: string;
  // Live notes only, oldest first.
  notes: ChatNote[];
  fileNames: string[];
  done: boolean;
  onEditNote(id: string, text: string): void;
  onForgetNote(id: string): void;
  onMarkDone(): void;
  onDelete(): void;
  onClose(): void;
}) {
  const T = useTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const heading: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.13em",
    textTransform: "uppercase", color: T.ink3, margin: 0,
  };
  const body: React.CSSProperties = {
    fontSize: 12, lineHeight: 1.45, color: T.ink2, margin: 0,
  };
  const ghostBtn: React.CSSProperties = {
    borderRadius: 9, border: `1px solid ${lt(0.08)}`, background: "transparent",
    color: T.ink2, fontSize: 12, fontWeight: 500, padding: "7px 14px",
    cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
  };

  return (
    <div
      className="sl-selectable"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: "12px 16px 16px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>About this chat</span>
        <button type="button" className="no-drag" onClick={onClose} style={ghostBtn}>
          Back to chat
        </button>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={heading}>Goal</p>
        <p style={body}>{goal}</p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={heading}>Where it was left</p>
        <p style={body}>{whereWeLeftOff}</p>
        {tidyNote && (
          <p style={{ ...body, marginTop: 6, fontSize: 11, opacity: 0.75 }}>
            Tidied after your last visit: {tidyNote}
          </p>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={heading}>What the coach remembers here ({notes.length})</p>
        {notes.length === 0 && (
          <p style={{ ...body, color: T.ink3 }}>
            Nothing yet. The coach notes things down as you work.
          </p>
        )}
        {notes.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            onEdit={(text) => onEditNote(n.id, text)}
            onForget={() => onForgetNote(n.id)}
          />
        ))}
      </section>

      {fileNames.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={heading}>Attached files</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {fileNames.map((name, i) => (
              <span
                key={i}
                title={name}
                style={{
                  borderRadius: 6, border: `1px solid ${lt(0.08)}`,
                  background: lt(0.04), padding: "2px 8px",
                  fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {!done && (
          <button type="button" className="no-drag" onClick={onMarkDone} style={ghostBtn}>
            Mark done
          </button>
        )}
        {!confirmDelete ? (
          <button
            type="button"
            className="no-drag"
            onClick={() => setConfirmDelete(true)}
            style={{ ...ghostBtn, color: "#C22F2F" }}
          >
            Delete chat
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
            <p style={body}>Delete this chat? Its conversation, steps and notes go for good.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="no-drag"
                onClick={onDelete}
                style={{
                  ...ghostBtn,
                  border: "1px solid rgba(219,59,59,0.45)",
                  background: "rgba(219,59,59,0.12)",
                  color: "#C22F2F",
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="no-drag"
                onClick={() => setConfirmDelete(false)}
                style={ghostBtn}
              >
                Keep it
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function NoteRow({
  note,
  onEdit,
  onForget,
}: {
  note: ChatNote;
  onEdit(text: string): void;
  onForget(): void;
}) {
  const T = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);

  const linkBtn: React.CSSProperties = {
    border: 0, background: "transparent", padding: 0, cursor: "pointer",
    fontSize: 10.5, color: T.ink3, fontFamily: "inherit",
  };

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: "6px 10px", borderRadius: 9,
        background: lt(0.04), border: `1px solid ${lt(0.07)}`,
      }}
    >
      {editing ? (
        <textarea
          className="no-drag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          autoFocus
          style={{
            width: "100%", resize: "vertical", fontSize: 11.5, lineHeight: 1.45,
            fontFamily: "inherit", color: T.ink, background: "transparent",
            border: `1px solid ${lt(0.12)}`, borderRadius: 6, padding: "4px 6px",
          }}
        />
      ) : (
        <span style={{ fontSize: 11.5, lineHeight: 1.45, color: T.ink2 }}>{note.text}</span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SeenMark seen={note.seen} />
        <span style={{ flex: 1 }} />
        {editing ? (
          <>
            <button
              type="button"
              className="no-drag"
              style={{ ...linkBtn, color: T.accentText }}
              onClick={() => {
                if (draft.trim()) onEdit(draft);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="no-drag"
              style={linkBtn}
              onClick={() => {
                setDraft(note.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="no-drag"
              style={linkBtn}
              onClick={() => {
                setDraft(note.text);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" className="no-drag" style={linkBtn} onClick={onForget}>
              Forget
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Seen on screen" or "Not yet confirmed" — shared with About you, where a
 * fact the user confirmed by hand carries the same mark under its own label.
 */
export function SeenMark({
  seen,
  seenLabel = "Seen on screen",
  seenTitle = "The coach read this on your screen",
}: {
  seen: boolean;
  seenLabel?: string;
  seenTitle?: string;
}) {
  const T = useTheme();
  return (
    <span
      title={
        seen
          ? seenTitle
          : "The coach was told this or assumed it — it has not seen it on screen"
      }
      style={{
        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: seen ? T.accentText : T.ink3,
      }}
    >
      {seen ? seenLabel : "Not yet confirmed"}
    </span>
  );
}
