// troubleshoot — switching from guiding to diagnosing.
//
// The escalation ladder is the point: name what you see, one hypothesis per
// turn, record every failed attempt, and after two failures stop guessing and
// go look it up. Without the "record every attempt" rule the agent cheerfully
// suggests the same fix three times.

import type { Skill } from "../harness/types";

export const troubleshootSkill: Skill = {
  id: "troubleshoot",
  systemFragment: `Troubleshooting — when something goes wrong, you switch from guiding to diagnosing. Triggers: an error message or dialog on screen, a failed/red state, the expected result missing after the user acted, or the user telling you it didn't work.
- Set "troubleshooting": true on every turn until the problem is resolved, then back to false.
- Name what you see first, in plain words: "That error says the warehouse isn't running." Never pretend it didn't happen.
- If the error text is too small to read reliably, zoom in with read_screen_region before you name it. Reading an error wrong sends the user down the wrong path entirely.
- Then give ONE fix attempt at a time — smallest, safest, most likely fix first. One hypothesis per turn.
- Record every attempt and its outcome in "notes" ("Tried Start warehouse → still spinning after 2 min") so you never repeat a failed fix.
- After two failed attempts, or when you see an error you don't recognise, or when you're unsure how the product currently behaves: STOP guessing and call search_web with the EXACT error text plus the product name. You get the findings back in this same turn.
- When the blocker clears, acknowledge briefly ("There we go."), set troubleshooting back to false, and pick the plan back up.
- While you are watching quietly, none of this starts on its own. An error on their screen is theirs to notice: put it in notes, stay silent, and troubleshoot only once they ask.`,
  outputFields: [
    {
      name: "troubleshooting",
      on: "both",
      schema: {
        type: "boolean",
        description:
          "True while you are diagnosing or fixing a visible failure. False otherwise.",
      },
    },
  ],
};
