// memory — facts that survive to the next session.
//
// The agent passes in a line about what is worth remembering (the coach's is
// in coach.ts), so the mechanism stays here and the judgement stays with it.
//
// The recalled facts are resolved ONCE at session start and passed in
// unchanged on every tick — if they were re-ranked per turn the prompt prefix
// would churn and the cache would collapse.

import type { Skill } from "../harness/types";

const BASE_RULES = `Memory across sessions — you meet this user again. "notes" is your scratchpad for THIS session; "remember" is different: it records a fact that will still be true and still be useful the NEXT time they start a session, days from now.
- Set "remember" at most once every few turns, and only for something durable.
- Do NOT remember anything transient: what's on screen right now, which step they're on, or how this session is going.
- Do NOT remember anything sensitive: passwords, card numbers, security answers, or personal details they didn't volunteer as relevant to the task.
- Keep it under 20 words and write it as a standalone fact — future-you sees the sentence with none of this session's context.
- The context header shows what you already remember. Never re-record something already there, and never read the list back to the user — just quietly use it. If the screen contradicts a remembered fact, believe the screen.
- Set "seen" inside "remember" to true only when you read the fact on the screen; leave it out when the user told you or you assumed it. Facts marked unconfirmed in the header were never seen.`;

const REMEMBER_FIELD = {
  name: "remember",
  on: "both" as const,
  // Plain "object" rather than a nullable type union: the field is optional,
  // so "nothing to record" is expressed by omitting it. A type array is
  // outside the JSON Schema subset the API is documented to accept, and this
  // schema is on the cached prefix of every single call.
  schema: {
    type: "object",
    description:
      "A durable cross-session fact. Omit this field entirely on almost every turn.",
    properties: {
      kind: {
        type: "string",
        enum: ["setup", "preference", "history", "obstacle"],
      },
      content: { type: "string", description: "The fact, under 20 words." },
      seen: {
        type: "boolean",
        description: "True only if you read this fact on screen. Omit otherwise.",
      },
    },
    required: ["kind", "content"],
  },
};

const RECALL_BLOCK = (ctx: { recalledMemory?: string }) =>
  ctx.recalledMemory && ctx.recalledMemory.trim().length > 0
    ? [ctx.recalledMemory.trim()]
    : [];

/**
 * Build the memory skill with the agent's line about what is worth keeping.
 */
export function memorySkill(worthRemembering: string): Skill {
  return {
    id: "memory",
    systemFragment: `${BASE_RULES}\n- ${worthRemembering}`,
    contextBlocks: RECALL_BLOCK,
    outputFields: [REMEMBER_FIELD],
  };
}
