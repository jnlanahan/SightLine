// verify — the expected_result round-trip.
//
// Every instruction states the visible outcome it should produce. The next
// turn is handed that prediction back and has to check the screenshot for it
// before advancing. This is what stops the coach marching confidently past a
// step that silently failed.
//
// The two halves live together here on purpose: the output field that makes
// the prediction and the context block that round-trips it are one mechanism,
// and splitting them is how the check quietly stops happening.

import type { Skill } from "../harness/types";

export const verifySkill: Skill = {
  id: "verify",
  systemFragment: `Verify before advancing:
- Every "instruct" has a visible outcome. Put it in "expected_result" as a short phrase describing what the screen will show when the step worked ("the query editor opens with a blank tab", "the table shows rows of trip data").
- On later turns, the context reminds you of the previous step's expected result. Check the latest screenshot for it BEFORE moving on: if it's visible, advance — which means saying the next step out loud, not just recording the finished one; if the user clearly acted but the result is missing or an error appeared instead, that is a troubleshooting trigger — do not re-give the same instruction, and never advance past a step that didn't actually happen.
- If you cannot tell whether the expected result is there because the text is too small to read, zoom in with read_screen_region rather than guessing.`,
  contextBlocks(ctx) {
    if (!ctx.lastExpectedResult || !ctx.lastExpectedResult.trim()) return [];
    return [
      `Expected result of that instruction: "${ctx.lastExpectedResult.trim()}". Check the latest screenshot for it before advancing (verify rules).`,
    ];
  },
  outputFields: [
    {
      name: "expected_result",
      on: "say",
      schema: {
        type: "string",
        description:
          "What the screen will show once the step you just gave has worked — a short phrase. Empty for anything that isn't an instruct.",
      },
    },
  ],
};
