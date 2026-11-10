// pastChats — the coach can look back through earlier chats.
//
// Pure tooling plus one prompt paragraph on when the round trip is worth it.
// The tool itself is in ../tools/memory-search.ts.

import type { Skill } from "../harness/types";
import { searchMemoryTool } from "../tools/memory-search";

export const pastChatsSkill: Skill = {
  id: "pastChats",
  systemFragment: `Earlier chats — you have a search_memory tool that searches your earlier chats with this user and the facts saved about them, in this same turn. Use it when the user refers to something from before ("like last time", "that error we fixed"), or when the problem in front of you looks like one you may have met with them already. Don't use it on every look, and don't use it for what this chat already tells you. When it finds something, use it naturally in your own words — "we fixed this in March by turning off the VPN" — never read the results back as a list.`,
  tools: [searchMemoryTool],
};
