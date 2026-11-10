// research — looking things up mid-turn.
//
// Contributes the search_web tool. (An earlier deferred variant asked the app
// to search between turns through two output fields; it went with the teacher
// agent, its only user.)

import type { Skill } from "../harness/types";
import { searchWebTool } from "../tools/research";

/** Research with the live tool. */
export const researchSkill: Skill = {
  id: "research",
  systemFragment: `Looking things up — you have a search_web tool that returns a short factual summary in this same turn. Use it the moment you are blocked by something you cannot know from the screen: an unfamiliar error, whether a menu has moved in a newer version, the current steps for a task you're unsure of. The user is a non-expert who needs accurate, current steps — do not guess when you could check. Do not use it for anything the screenshot already answers.`,
  tools: [searchWebTool],
};
