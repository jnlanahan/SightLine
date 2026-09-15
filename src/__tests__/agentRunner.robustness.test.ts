import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { historyMessages, runAgentTurn } from "../../electron/agents/harness/runner";
import { parseTerminalTool } from "../../electron/agents/harness/parse-turn";
import { getAgent } from "../../electron/agents/registry";
import { newPlanDraft } from "../../electron/agents/harness/types";
import type { ConversationTurn } from "../../electron/types";

// The failure modes here all showed up as "the coach went quiet" or "my steps
// vanished" with nothing useful in the log. Each one is a request the API
// rejects or a response the SDK hands back partially, and the runner has to
// keep the session alive through all of them.

function turn(role: "user" | "assistant", content: string): ConversationTurn {
  return { role, content, timestamp: 0 };
}

describe("historyMessages", () => {
  it("always opens on a user turn — the API rejects a leading assistant message", () => {
    // Ten spoken instructions with no typed follow-up: the naive tail slice
    // was all-assistant and every later tick got a 400.
    const convo = [
      turn("user", "Goal: set up a VPN"),
      ...Array.from({ length: 12 }, (_, i) => turn("assistant", `Step ${i + 1}`)),
    ];
    const msgs = historyMessages(convo);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Goal: set up a VPN");
    // The recent instructions are still all there — only the anchor was added.
    expect(msgs.slice(-1)[0].content).toBe("Step 12");
    expect(msgs).toHaveLength(11);
  });

  it("anchors on the most recent user turn before the tail", () => {
    const convo = [
      turn("user", "Goal"),
      turn("assistant", "a"),
      turn("user", "what's next?"),
      turn("assistant", "b"),
      turn("assistant", "c"),
      turn("assistant", "d"),
    ];
    const msgs = historyMessages(convo, 3);
    expect(msgs.map((m) => m.content)).toEqual(["what's next?", "b", "c", "d"]);
  });

  it("leaves a tail that already starts with the user alone", () => {
    const convo = [turn("user", "Goal"), turn("assistant", "a")];
    expect(historyMessages(convo).map((m) => m.content)).toEqual(["Goal", "a"]);
  });

  it("returns nothing rather than an invalid slice when no user turn survives", () => {
    const convo = Array.from({ length: 5 }, (_, i) => turn("assistant", `s${i}`));
    expect(historyMessages(convo)).toEqual([]);
  });
});

describe("the code field", () => {
  it("keeps indentation and interior line breaks — it's meant to be pasted", () => {
    const yaml = "\n\nname: CI\non:\n  push:\n    branches: [main]\n  \n";
    const parsed = parseTerminalTool(
      "say",
      { action: "instruct", instruction: "Paste this.", code: yaml },
      [],
    );
    expect(parsed.code).toBe("name: CI\non:\n  push:\n    branches: [main]");
  });

  it("is empty on a silent turn and when absent", () => {
    expect(parseTerminalTool("wait", { code: "x" }, []).code).toBe("");
    expect(parseTerminalTool("say", { action: "instruct", instruction: "Hi." }, []).code).toBe("");
  });
});

describe("an empty completed_steps never erases progress", () => {
  it("keeps the previous list when the model sends []", () => {
    const parsed = parseTerminalTool("wait", { completed_steps: [] }, ["Opened Settings"]);
    expect(parsed.completedSteps).toEqual(["Opened Settings"]);
  });

  it("accepts [] when there was nothing to lose", () => {
    const parsed = parseTerminalTool("wait", { completed_steps: [] }, []);
    expect(parsed.completedSteps).toEqual([]);
  });

  it("accepts a real replacement list", () => {
    const parsed = parseTerminalTool(
      "wait",
      { completed_steps: ["Opened Settings", "Clicked Network"] },
      ["Opened Settings"],
    );
    expect(parsed.completedSteps).toEqual(["Opened Settings", "Clicked Network"]);
  });
});

type Scripted = {
  content: unknown[];
  stop_reason: string;
  /** Streamed deltas for a say block, if any. */
  sayChunks?: string[];
};

function fakeClient(responses: Scripted[]) {
  let call = 0;
  const client = {
    messages: {
      stream() {
        const r = responses[Math.min(call, responses.length - 1)];
        call += 1;
        const events: unknown[] = [];
        if (r.sayChunks) {
          events.push({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "t1", name: "say" },
          });
          for (const partial_json of r.sayChunks) {
            events.push({
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json },
            });
          }
        }
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of events) yield e;
          },
          async finalMessage() {
            return {
              content: r.content,
              stop_reason: r.stop_reason,
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };
      },
    },
  };
  return client as unknown as Anthropic;
}

function opts(client: Anthropic, completedSteps: string[]) {
  return {
    client,
    model: "claude-sonnet-4-6",
    agent: getAgent("tech_support"),
    ctx: {
      mode: "tech_support" as const,
      goal: "Set up a VPN",
      completedSteps,
      upcomingSteps: ["Connect to a server"],
      conversation: [],
      frames: [],
    },
    deps: {
      captureRegion: async () => null,
      research: async () => "findings",
      planDraft: newPlanDraft(),
      log: () => {},
    },
    toContextResolution: (d: string) => d,
    log: () => {},
  };
}

describe("a response cut off by max_tokens", () => {
  it("keeps the previous step lists instead of the truncated ones", async () => {
    const previous = ["Downloaded the client", "Created an account", "Installed it"];
    const client = fakeClient([
      {
        stop_reason: "max_tokens",
        // The SDK's partial parse yields whatever had arrived — here a
        // one-item step list that would otherwise replace all three.
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "say",
            input: {
              action: "instruct",
              instruction: "Open the VPN client and",
              completed_steps: ["Downloaded the client"],
            },
          },
        ],
      },
    ]);
    const result = await runAgentTurn(opts(client, previous));
    expect(result.completedSteps).toEqual(previous);
    expect(result.upcomingSteps).toEqual(["Connect to a server"]);
    // What was said was already spoken; the text itself still comes through.
    expect(result.instruction).toBe("Open the VPN client and");
  });
});

describe("a response with no tool call", () => {
  it("ends the turn silently rather than reading raw text aloud", async () => {
    const client = fakeClient([
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I can't help with that." }],
      },
    ]);
    const result = await runAgentTurn(opts(client, ["a"]));
    expect(result.action).toBe("wait");
    expect(result.instruction).toBe("");
    expect(result.completedSteps).toEqual(["a"]);
  });

  it("still reads an old-style JSON blob", async () => {
    const client = fakeClient([
      {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: '{"action":"instruct","instruction":"Click Connect.","completed_steps":["a","b"]}',
          },
        ],
      },
    ]);
    const result = await runAgentTurn(opts(client, ["a"]));
    expect(result.action).toBe("instruct");
    expect(result.instruction).toBe("Click Connect.");
    expect(result.completedSteps).toEqual(["a", "b"]);
  });
});
