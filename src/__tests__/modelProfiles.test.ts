// The coach can run on Sonnet 5.5 or Opus 5.5, and those models do not accept
// the request the older ones did. These lock how a look is asked of each, and
// what the runner does about the one guarantee the newer models withdrew: that
// a reply is always a tool call.

import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentTurn } from "../../electron/agents/harness/runner";
import { getAgent } from "../../electron/agents/registry";
import {
  COACH_MODELS,
  FALLBACK_COACH_MODEL,
  coachModelFor,
  modelLabel,
  profileFor,
} from "../../electron/agents/harness/models";
import type { SpeechChunk } from "../../electron/speech-chunker";

type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
interface Reply {
  stop_reason: string;
  content: Block[];
}
interface Call {
  endpoint: "messages" | "beta";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
}

/** A fake client that records which endpoint each request went to and what it carried. */
function fake(replies: Reply[]) {
  const calls: Call[] = [];
  let i = 0;
  const make = (endpoint: Call["endpoint"]) => ({
    stream(params: unknown) {
      // Snapshot now: the runner keeps appending to the same messages array.
      calls.push({ endpoint, params: JSON.parse(JSON.stringify(params)) });
      const r = replies[Math.min(i, replies.length - 1)];
      i += 1;
      const events: unknown[] = [];
      r.content.forEach((b, index) => {
        if (b.type !== "tool_use") return;
        events.push({
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: b.id, name: b.name },
        });
        events.push({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) },
        });
      });
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
  });
  const client = { messages: make("messages"), beta: { messages: make("beta") } };
  return { client: client as unknown as Anthropic, calls };
}

const say = (instruction: string): Reply => ({
  stop_reason: "tool_use",
  content: [
    { type: "tool_use", id: "t_say", name: "say", input: { action: "instruct", instruction } },
  ],
});
const search = (id: string): Reply => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name: "search_web", input: { query: "error 1603" } }],
});
const justText: Reply = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: "Press Ctrl+S to save." }],
};

function opts(
  client: Anthropic,
  model: string,
  extra: { research?: () => Promise<string>; onSpeechChunk?: (c: SpeechChunk) => void } = {},
) {
  return {
    client,
    model,
    agent: getAgent(),
    ctx: {
      goal: "Fix the installer",
      completedSteps: [],
      upcomingSteps: [],
      conversation: [],
      frames: [],
    },
    deps: {
      captureRegion: async () => null,
      research: extra.research ?? (async () => "findings"),
      searchMemory: async () => [],
      log: () => {},
    },
    toContextResolution: (d: string) => d,
    onSpeechChunk: extra.onSpeechChunk,
    log: () => {},
  };
}

describe("which model the coach runs on", () => {
  it("offers Sonnet 5.5 and Opus 5.5, Sonnet by default", () => {
    expect(COACH_MODELS).toEqual({ sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" });
    expect(coachModelFor("opus")).toBe("claude-opus-5-5");
    expect(coachModelFor("sonnet")).toBe("claude-sonnet-5-5");
    expect(coachModelFor(undefined)).toBe("claude-sonnet-5-5");
    expect(coachModelFor("something else")).toBe("claude-sonnet-5-5");
  });

  it("falls back to a model that still accepts a forced tool call", () => {
    expect(FALLBACK_COACH_MODEL).toBe("claude-sonnet-5");
    expect(profileFor(FALLBACK_COACH_MODEL).forcedToolChoice).toBe(true);
  });

  // "I'm not even sure what model I was just on." The panel names it, using
  // the same names as the Settings picker, and names the fallback too.
  it("has a plain name for every model the coach can end up on", () => {
    expect(modelLabel(COACH_MODELS.sonnet)).toBe("Sonnet 5.5");
    expect(modelLabel(COACH_MODELS.opus)).toBe("Opus 5.5");
    expect(modelLabel(FALLBACK_COACH_MODEL)).toBe("Sonnet 5");
    expect(modelLabel("some-future-model")).toBe("some-future-model");
  });

  it("reports the model a look ran on with its answer, and the loop logs it", async () => {
    const { client } = fake([say("Open Settings.")]);
    const result = await runAgentTurn(opts(client, "claude-opus-5-5"));
    expect(result.model).toBe("claude-opus-5-5");
    const loop = (await import("../hooks/useSessionLoop?raw")) as unknown as { default: string };
    expect(loop.default).toContain("useSession.getState().setModel(result.model);");
    expect(loop.default).toContain("model=${result.model");
  });
});

describe("how a look is asked of each model", () => {
  it("Sonnet 5.5: thinking at its lowest setting, no forced tool call", async () => {
    const { client, calls } = fake([say("Open Settings.")]);
    await runAgentTurn(opts(client, "claude-sonnet-5-5"));
    const p = calls[0].params;
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.thinking).toEqual({ type: "between_tools" });
    expect(p.output_config).toEqual({ effort: "medium" });
    // "any" is rejected by this model outright.
    expect(p.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(p.max_tokens).toBe(4096);
  });

  it("Opus 5.5: no thinking setting at all, low effort, room to think", async () => {
    const { client, calls } = fake([say("Open Settings.")]);
    await runAgentTurn(opts(client, "claude-opus-5-5"));
    const p = calls[0].params;
    // Any explicit "off" is rejected by this model; effort is the only dial.
    expect(p).not.toHaveProperty("thinking");
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(p.max_tokens).toBe(8000);
  });

  it("the 5.5 models ask the API to retry a safety decline on another model", async () => {
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
      const { client, calls } = fake([say("Open Settings.")]);
      await runAgentTurn(opts(client, model));
      expect(calls[0].endpoint).toBe("beta");
      expect(calls[0].params.betas).toEqual(["server-side-fallback-2026-07-01"]);
      expect(calls[0].params.fallbacks).toBe("default");
    }
  });

  it("the fallback model: forced tool call, thinking off, the ordinary endpoint", async () => {
    const { client, calls } = fake([say("Open Settings.")]);
    await runAgentTurn(opts(client, "claude-sonnet-5"));
    const p = calls[0].params;
    expect(calls[0].endpoint).toBe("messages");
    expect(p.thinking).toEqual({ type: "disabled" });
    expect(p.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
    expect(p).not.toHaveProperty("output_config");
    expect(p).not.toHaveProperty("fallbacks");
    expect(p).not.toHaveProperty("betas");
  });

  it("every model gets the same cached prompt and tool list", async () => {
    const seen: string[] = [];
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5"]) {
      const { client, calls } = fake([say("Open Settings.")]);
      await runAgentTurn(opts(client, model));
      seen.push(JSON.stringify([calls[0].params.system, calls[0].params.tools]));
    }
    expect(new Set(seen).size).toBe(1);
  });
});

describe("a reply that calls no tool (possible only without a forced tool call)", () => {
  it("is asked once more in the same look, and the answer is spoken", async () => {
    const chunks: SpeechChunk[] = [];
    const { client, calls } = fake([justText, say("Press Control S to save.")]);
    const result = await runAgentTurn(
      opts(client, "claude-sonnet-5-5", { onSpeechChunk: (c) => chunks.push(c) }),
    );
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].params.messages)).toContain(
      "Text outside a tool call is never heard",
    );
    expect(result.action).toBe("instruct");
    expect(result.instruction).toBe("Press Control S to save.");
    // Only the say call's words are spoken — never the stray text.
    expect(chunks.map((c) => c.text)).toEqual(["Press Control S to save."]);
  });

  it("ends in silence if the second ask gets no tool either — it never reads raw text aloud", async () => {
    const chunks: SpeechChunk[] = [];
    const { client, calls } = fake([justText]);
    const result = await runAgentTurn(
      opts(client, "claude-opus-5-5", { onSpeechChunk: (c) => chunks.push(c) }),
    );
    expect(calls).toHaveLength(2);
    expect(result.action).toBe("wait");
    expect(chunks).toEqual([]);
  });

  it("does not ask again after a safety decline", async () => {
    const { client, calls } = fake([{ stop_reason: "refusal", content: [] }]);
    const result = await runAgentTurn(opts(client, "claude-sonnet-5-5"));
    expect(calls).toHaveLength(1);
    expect(result.action).toBe("wait");
  });

  it("keeps the model's own blocks when it asks again", async () => {
    // Thinking on these models is tied to the request it came from; the
    // reply has to go back exactly as it arrived.
    const withThinking: Reply = {
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "Press Ctrl+S to save." },
      ],
    };
    const { client, calls } = fake([withThinking, say("Press Control S.")]);
    await runAgentTurn(opts(client, "claude-opus-5-5"));
    const sentBack = calls[1].params.messages.at(-2);
    expect(sentBack.role).toBe("assistant");
    expect(sentBack.content).toEqual(withThinking.content);
  });

  it("is not something the fallback model can do, so it is never asked twice", async () => {
    const { client, calls } = fake([justText]);
    const result = await runAgentTurn(opts(client, "claude-sonnet-5"));
    expect(calls).toHaveLength(1);
    expect(result.action).toBe("wait");
  });
});

describe("lookups on a model whose tool list must not change mid-look", () => {
  it("keeps the whole tool list on every request of the look", async () => {
    const { client, calls } = fake([search("t1"), search("t2"), say("That's a permissions error.")]);
    const result = await runAgentTurn(opts(client, "claude-sonnet-5-5"));
    expect(calls).toHaveLength(3);
    const names = calls.map((c) => c.params.tools.map((t: { name: string }) => t.name));
    expect(names[1]).toEqual(names[0]);
    expect(names[2]).toEqual(names[0]);
    expect(names[0]).toContain("search_web");
    expect(result.instruction).toBe("That's a permissions error.");
  });

  it("says in words when the lookups have run out", async () => {
    const { client, calls } = fake([search("t1"), search("t2"), say("Done.")]);
    await runAgentTurn(opts(client, "claude-sonnet-5-5"));
    // Not after the first lookup: one is still allowed.
    expect(JSON.stringify(calls[1].params.messages)).not.toContain("last lookup this turn");
    expect(JSON.stringify(calls[2].params.messages)).toContain("last lookup this turn");
  });

  it("ends in silence rather than running past the limit", async () => {
    const research = vi.fn(async () => "findings");
    const { client, calls } = fake([search("t1"), search("t2"), search("t3")]);
    const result = await runAgentTurn(opts(client, "claude-sonnet-5-5", { research }));
    expect(calls).toHaveLength(3);
    expect(research).toHaveBeenCalledTimes(2);
    expect(result.action).toBe("wait");
  });

  it("the fallback model still has its list narrowed to say and wait at the end", async () => {
    const { client, calls } = fake([search("t1"), search("t2"), say("Done.")]);
    await runAgentTurn(opts(client, "claude-sonnet-5"));
    expect(calls[2].params.tools.map((t: { name: string }) => t.name)).toEqual(["say", "wait"]);
  });
});
