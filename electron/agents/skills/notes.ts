// notes — the within-session scratchpad.
//
// Shared by all three agents. Deliberately separate from `memory`: notes die
// with the session, memories outlive it. Conflating them is how a coach ends
// up "remembering" which step the user was on three days ago.

import type { Skill } from "../harness/types";

export const notesSkill: Skill = {
  id: "notes",
  systemFragment: `"notes" is your private scratchpad for THIS session. Record durable facts worth remembering across steps — research findings, the user's specific setup (account, version, folder), decisions made, fixes you already tried. Keep each note to one short line. Your notes are shown back to you on every later turn. Leave it empty when there is nothing new; never repeat a note you already wrote. Set "note_seen" to true only when the note records something you read on the screen this turn; leave it out when the user told you, or you inferred or assumed it.`,
  contextBlocks(ctx) {
    if (!ctx.agentNotes || ctx.agentNotes.length === 0) return [];
    return [
      `Your notes so far (memory you recorded on earlier turns):\n` +
        ctx.agentNotes.map((n) => `- ${n}`).join("\n"),
    ];
  },
  outputFields: [
    {
      name: "notes",
      on: "both",
      schema: {
        type: "string",
        description:
          "One short line worth remembering for the rest of this session, or an empty string.",
      },
    },
    {
      name: "note_seen",
      on: "both",
      schema: {
        type: "boolean",
        description:
          "True only if this turn's note records something you read on screen. Omit otherwise.",
      },
    },
  ],
};
