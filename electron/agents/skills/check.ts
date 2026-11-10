// check — knowing when a step is really done, and what to say about it.
//
// One mechanism for both stances. Every step or task the coach gives states
// the visible outcome it should produce (`expected_result`); the next turns
// are handed that prediction back. In guide the coach checks it on every look
// before advancing — which is what stops it marching confidently past a step
// that silently failed. In watch the same prediction is what it grades
// against, but only when the user asks.
//
// The output field that makes the prediction and the context block that
// round-trips it live together on purpose: they are one mechanism, and
// splitting them is how the check quietly stops happening.
//
// The grading rules come from a human-tested trainer playbook: name what's
// right first, fix at most one thing per response, never pass work that isn't
// done. "One thing" is about retention — a list of five corrections teaches
// none of them.

import type { Skill } from "../harness/types";

export const checkSkill: Skill = {
  id: "verify",
  systemFragment: `Knowing when a step is really done:
- Every step or task you give has a visible outcome. Put it in "expected_result" as a short phrase describing what the screen will show when it worked ("the query editor opens with a blank tab", "the pivot table shows monthly totals"). It must be something you could see in a screenshot — never "understands X".
- In guide, the context reminds you of that expected result. Check the latest screenshot for it BEFORE moving on: if it's visible, advance — which means saying the next step out loud, not just recording the finished one; if the user clearly acted but the result is missing or an error appeared instead, that is a troubleshooting trigger — do not re-give the same instruction, and never advance past a step that didn't actually happen.
- In watch, you don't judge until asked. When the user says "check my work" (or anything like it), grade what you can see against the expected result:
  - Start with what's specifically right — name the real thing on screen, not generic praise.
  - Fix at most ONE thing per response, the most important one. Save the rest for the next check.
  - Add the task to completed_steps only when its expected result is visibly there. Never pass work that isn't there — a kind "not yet" now beats confusion later. When it does pass, say so plainly and set the next task in one sentence (action="instruct", with its own expected_result).
  - If you genuinely can't see enough to judge, ask them to bring the work on screen.
- When the user says "I'm stuck" (or anything like it) in watch, respond with a question or the smallest hint that gets them moving — never the full answer. If they're STILL stuck after a hint, give progressively more, one rung at a time. In guide, being stuck just means they need the next concrete step.
- If you cannot tell whether the expected result is there because the text is too small to read, zoom in with read_screen_region rather than guessing.
- When you notice the same KIND of mistake for the second time, record it in "notes" as a short phrase ("renames columns by editing raw data instead of headers") so later feedback can address it. Never recite your notes at the user.`,
  contextBlocks(ctx) {
    if (!ctx.lastExpectedResult || !ctx.lastExpectedResult.trim()) return [];
    const expected = ctx.lastExpectedResult.trim();
    return [
      ctx.stance === "watch"
        ? `What done looks like for the current task: "${expected}". Grade against it only when the user asks you to check.`
        : `Expected result of that instruction: "${expected}". Check the latest screenshot for it before advancing.`,
    ];
  },
  outputFields: [
    {
      name: "expected_result",
      on: "say",
      schema: {
        type: "string",
        description:
          "What the screen will show once the step or task you just gave is done — a short phrase. Empty for anything that isn't an instruct.",
      },
    },
  ],
};
