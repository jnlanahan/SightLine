// search_memory — looking back through earlier chats, in the same turn.
//
// Only a small, ranked slice of memory is in front of the coach on every look.
// This is how it reaches the rest: other chats' goals, notes, step logs and
// conversations, and the facts that did not make the cut. It runs locally —
// a keyword search over saved files, no AI call — so the round trip is short.
// The search itself is ../../memory-search.ts; the files arrive through deps.

import type { AgentTool } from "../harness/types";
import { formatSearchResults } from "../../memory-search";

export const searchMemoryTool: AgentTool = {
  name: "search_memory",
  description:
    "Search the user's earlier chats with you and the facts saved about them, in this same turn. Returns up to five short snippets, best first, each with the chat's title and when it was last active. Use it when the user refers to something from before (\"like last time\", \"the thing we fixed\") or the problem on screen looks like one you may have met with them already. Search with a few distinctive words: the product, the error, the task. Do not use it on every look.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A few distinctive keywords: the product, the error text, the task. Not a full sentence.",
      },
    },
    required: ["query"],
  },
  async run(input, deps) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      return { text: "No query given.", isError: true };
    }
    deps.log(`[tool] search_memory "${query.slice(0, 80)}"`);
    // A failed search throws; the runner turns that into an is_error result
    // so the look carries on.
    const hits = await deps.searchMemory(query);
    deps.log(`[tool] search_memory found ${hits.length}`);
    return { text: formatSearchResults(query, hits, Date.now()) };
  },
};
