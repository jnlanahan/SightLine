// research — looking things up mid-turn.
//
// The live skill contributes the search_web tool. The deferred variant (no
// tool — the model asks the app to search and gets findings next turn)
// instead carries the two fields that drive the renderer's out-of-band
// research path. They are deliberately NOT on the live skill any more: they
// sat in every tech-support tick's cached prefix and schema, and a model that
// set them anyway triggered a torn-down turn plus a second call for something
// the tool answers in-turn.

import type { Skill } from "../harness/types";
import { searchWebTool } from "../tools/research";

const LEGACY_FIELDS: Skill["outputFields"] = [
  {
    name: "needsResearch",
    on: "both",
    schema: {
      type: "boolean",
      description:
        "Leave false — you have the search_web tool, which is faster. Only set this true if search_web is unavailable to you.",
    },
  },
  {
    name: "researchQuery",
    on: "both",
    schema: {
      type: "string",
      description: "The query, when needsResearch is true. Otherwise empty.",
    },
  },
];

/** Research with the live tool. */
export const researchSkill: Skill = {
  id: "research",
  systemFragment: `Looking things up — you have a search_web tool that returns a short factual summary in this same turn. Use it the moment you are blocked by something you cannot know from the screen: an unfamiliar error, whether a menu has moved in a newer version, the current steps for a task you're unsure of. The user is a non-expert who needs accurate, current steps — do not guess when you could check. Do not use it for anything the screenshot already answers.`,
  tools: [searchWebTool],
};

/**
 * Research WITHOUT the tool — the model asks the app to search and gets the
 * findings on the next turn. Used where a mid-turn round trip is not worth it.
 */
export const deferredResearchSkill: Skill = {
  id: "research",
  systemFragment: `Looking things up — when a specific external resource or current fact would genuinely help (a paper, a doc, a product's current behaviour), set needsResearch=true with a precise "researchQuery". The app searches and hands you the findings on your next turn. Never invent titles, URLs, or version-specific details you aren't sure of.`,
  outputFields: LEGACY_FIELDS,
};
