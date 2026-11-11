// stages — the shape of a goal that takes more than one sitting.
//
// A quick question has no plan and a walkthrough has a short list of steps.
// A long goal ("teach me pivot tables") needs one more level: a handful of
// stages, each with its own steps. The coach lays the stage titles out once
// and writes the steps for a stage only when the user reaches it — so the
// later stages can reflect how the earlier ones actually went, and no separate
// planning call is ever needed.
//
// The stage list and the current stage are chat state: the renderer keeps
// them, saves them with the chat, and shows them back in the context header.

import type { Skill } from "../harness/types";

export const stagesSkill: Skill = {
  id: "stages",
  systemFragment: `Long goals — stages. When the goal will clearly take more than one sitting (learning a tool, building something in several parts), lay it out in stages before you start:
- 3 to 8 stages, each a short title, in "stages". Anchor them on one concrete outcome the user cares about, so every stage produces a visible piece of it. Use the program they actually have open. Put an early win first.
- Tell the user the shape in one or two sentences. Don't read the whole list aloud; they can see it.
- "stage" is the one they're on, counting from 1. "upcoming_steps" holds the steps of the CURRENT stage only. Don't plan a later stage's steps until you get there.
- When the current stage's work is visibly done — while you're watching quietly, that means they asked you to check it and it passed — say so, move "stage" on by one, and set the first task of the next stage.
- When the last stage is done, the goal is done.
- If the route changes, send the new "stages" list and the right "stage" in the same turn.
A quick question or a short walkthrough has no stages: leave both fields out.`,
  contextBlocks(ctx) {
    const stages = ctx.stages ?? [];
    if (stages.length === 0) return [];
    const current = Math.min(Math.max(ctx.stageIndex ?? 0, 0), stages.length - 1);
    const lines = stages.map((title, i) => {
      const mark = i < current ? " — done" : i === current ? " — current" : "";
      return `  ${i + 1}. ${title}${mark}`;
    });
    return [
      `Plan stages (the user is on stage ${current + 1} of ${stages.length}):\n${lines.join("\n")}`,
    ];
  },
  outputFields: [
    {
      name: "stages",
      on: "both",
      schema: {
        type: "array",
        items: { type: "string" },
        description:
          "The stages of a long plan, in order: 3 to 8 short titles. Set it when you lay the plan out, and again only if the route changes. Omit on every other turn.",
      },
    },
    {
      name: "stage",
      on: "both",
      schema: {
        type: "integer",
        description:
          "Which stage the user is on now, counting from 1. Set it when you lay the plan out and when you move to the next stage. Omit otherwise.",
      },
    },
  ],
};
