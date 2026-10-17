// pointing — the glow box on the real screen.
//
// The agent returns a bounding box as fractions of the screenshot; the app
// flashes a glow there on the actual desktop. It only makes sense paired with
// an instruction to click one visible thing, which is why the field is
// restricted to "instruct" turns downstream.

import type { Skill } from "../harness/types";

export const pointingSkill: Skill = {
  id: "pointing",
  systemFragment: `Pointing at things — when an "instruct" tells the user to click or find ONE specific element that is VISIBLE in the latest screenshot (a button, tab, menu item, field), set "highlight" to that element's bounding box as fractions of the screenshot's width and height. The app flashes a glow there on the real screen so the user can find it. Box the WHOLE control — the icon plus its label, the full button or menu row, the entire input field — never just the icon or the word: a bigger box lands reliably where a tight one misses, and the app pads it further. Leave it out entirely when there's no single visible target, and always leave it out for anything that isn't an instruct.
The fractions are ALWAYS of the full image labelled "Latest screenshot" — never of a zoomed read_screen_region view. If you zoomed in this turn, convert back to full-screenshot fractions (zoom x + fraction-within-zoom × zoom w, and likewise for y/h) before setting highlight. A box in the wrong place is worse than no box: if you're not confident where the element is in the full screenshot, leave highlight out.`,
  outputFields: [
    {
      name: "highlight",
      on: "say",
      schema: {
        type: "object",
        description:
          "Bounding box of the one element to point at, as 0-1 fractions of the FULL latest screenshot (never of a zoomed view). Omit this field when there is no single visible target, when you're unsure of the position, or when this isn't an instruct.",
        properties: {
          x: { type: "number", description: "Left edge, 0-1." },
          y: { type: "number", description: "Top edge, 0-1." },
          w: { type: "number", description: "Width, 0-1." },
          h: { type: "number", description: "Height, 0-1." },
        },
        required: ["x", "y", "w", "h"],
      },
    },
  ],
};
