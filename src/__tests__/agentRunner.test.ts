import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentTurn } from "../../electron/agents/harness/runner";
import { getAgent } from "../../electron/agents/registry";
import { newPlanDraft, type ToolDeps } from "../../electron/agents/harness/types";
import type { SpeechChunk } from "../../electron/speech-chunker";

// Exercises the tool loop against a scripted stream. The runner is the piece
// that turns "the model called a tool" into "the user hears a sentence", so
// the behaviours locked here are the ones that break the app when they
// regress: speech starting mid-stream, silence staying silent, and a failing
// tool never taking the coach offline.

type ScriptedTurn = {
  tool: string;
  /** Tool input, split into chunks to simulate streamed partial JSON. */
  inputChunks: string[];
};

function toolUseBlock(name: string, input: unknown, id = "toolu_1") {
  return { type: "tool_use" as const, id, name, input };
}

/** A fake Anthropic client that replays `turns`, one per request. */
function fakeClient(turns: ScriptedTurn[]) {
  let call = 0;
  const requests: Array<Record<string, unknown>> = [];

  const client = {
    messages: {
      stream(params: Record<string, unknown>) {
        requests.push(params);
        const turn = turns[Math.min(call, turns.length - 1)];
        call += 1;
        const input = JSON.parse(turn.inputChunks.join(""));

        const events = [
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_1", name: turn.tool },
          },
          ...turn.inputChunks.map((partial_json) => ({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json },
          })),
          { type: "content_block_stop", index: 0 },
        ];

        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
          async finalMessage() {
            return {
              content: [toolUseBlock(turn.tool, input)],
              stop_reason: "tool_use",
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };
      },
    },
  };

  return { client: client as unknown as Anthropic, requests, callCount: () => call };
}

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    captureRegion: async () => null,
    research: async () => "findings",
    planDraft: newPlanDraft(),
    log: () => {},
    ...overrides,
  };
}

function baseOpts(client: Anthropic, onSpeechChunk?: (c: SpeechChunk) => void) {
  return {
    client,
    model: "claude-sonnet-4-6",
    agent: getAgent("tech_support"),
    ctx: {
      mode: "tech_support" as const,
      goal: "Set up a VPN",
      completedSteps: ["Downloaded the client"],
      upcomingSteps: [],
      conversation: [],
      frames: [],
    },
    deps: deps(),
    toContextResolution: (d: string) => d,
    onSpeechChunk,
    log: () => {},
  };
}

describe("a say turn speaks while it is still generating", () => {
  it("emits each finished sentence out of the streamed tool input", async () => {
    const chunks: SpeechChunk[] = [];
    // Split mid-word and mid-field, the way real deltas arrive.
    const { client } = fakeClient([
      {
        tool: "say",
        inputChunks: [
          '{"action":"instruct","instruc',
          'tion":"Open Settings. ',
          'Then click Network. ',
          'You\'ll see the VPN tab."',
          ',"expected_pace":"quick"}',
        ],
      },
    ]);

    const result = await runAgentTurn(baseOpts(client, (c) => chunks.push(c)));

    expect(chunks.map((c) => c.text)).toEqual([
      "Open Settings.",
      "Then click Network.",
      "You'll see the VPN tab.",
    ]);
    expect(result.action).toBe("instruct");
    expect(result.expectedPace).toBe("quick");
    expect(result.instruction).toBe(
      "Open Settings. Then click Network. You'll see the VPN tab.",
    );
  });
});

describe("a wait turn is silent from the first event", () => {
  it("emits no speech chunks at all", async () => {
    const chunks: SpeechChunk[] = [];
    const { client } = fakeClient([
      { tool: "wait", inputChunks: ['{"notes":"user is typing"}'] },
    ]);

    const result = await runAgentTurn(baseOpts(client, (c) => chunks.push(c)));

    expect(chunks).toEqual([]);
    expect(result.action).toBe("wait");
    expect(result.instruction).toBe("");
  });

  it("still records progress on a silent turn", async () => {
    // The loop has always applied bookkeeping on every action including wait,
    // so the agent can mark progress without speaking.
    const { client } = fakeClient([
      {
        tool: "wait",
        inputChunks: ['{"completed_steps":["Downloaded the client","Installed it"]}'],
      },
    ]);
    const result = await runAgentTurn(baseOpts(client));
    expect(result.completedSteps).toEqual([
      "Downloaded the client",
      "Installed it",
    ]);
  });
});

describe("a finished step is never answered with silence", () => {
  // The bug this locks, from a live session: the user clicked what the coach
  // asked, the model noticed (its step list grew) and then called wait. The
  // user, waiting on the coach, sat still — so the screen-change gate skipped
  // every later tick, and they had to press "I did this" to hear the next
  // step. The runner now hands such a wait back and asks for speech in the
  // same turn.
  const grown = '{"completed_steps":["Downloaded the client","Installed it"]}';

  it("hands a wait that recorded a new step back and speaks on the next pass", async () => {
    const chunks: SpeechChunk[] = [];
    const { client, requests } = fakeClient([
      { tool: "wait", inputChunks: [grown] },
      {
        tool: "say",
        inputChunks: ['{"action":"instruct","instruction":"Nice, that\'s in. Now open it."}'],
      },
    ]);

    const result = await runAgentTurn(baseOpts(client, (c) => chunks.push(c)));

    expect(result.action).toBe("instruct");
    expect(result.instruction).toBe("Nice, that's in. Now open it.");
    expect(chunks.map((c) => c.text)).toEqual(["Nice, that's in.", "Now open it."]);
    expect(requests).toHaveLength(2);
    const second = requests[1].messages as Anthropic.Messages.MessageParam[];
    expect(JSON.stringify(second)).toContain("newly completed step");
  });

  it("accepts a wait that recorded nothing new without a second request", async () => {
    const { client, callCount } = fakeClient([
      {
        tool: "wait",
        inputChunks: ['{"completed_steps":["Downloaded the client"],"notes":"typing"}'],
      },
    ]);
    const result = await runAgentTurn(baseOpts(client));
    expect(result.action).toBe("wait");
    expect(callCount()).toBe(1);
  });

  it("asks only once — a second wait is the model's answer", async () => {
    const { client, callCount } = fakeClient([{ tool: "wait", inputChunks: [grown] }]);
    const result = await runAgentTurn(baseOpts(client));
    expect(result.action).toBe("wait");
    expect(result.completedSteps).toEqual(["Downloaded the client", "Installed it"]);
    expect(callCount()).toBe(2);
  });

  it("leaves training's silent activity log alone", async () => {
    // Training coaches by not talking; its scans record steps on wait by design.
    const { client, callCount } = fakeClient([{ tool: "wait", inputChunks: [grown] }]);
    const opts = baseOpts(client);
    const result = await runAgentTurn({
      ...opts,
      agent: getAgent("training"),
      ctx: { ...opts.ctx, mode: "training" as const },
    });
    expect(result.action).toBe("wait");
    expect(callCount()).toBe(1);
  });
});

describe("mid-turn tools loop before the agent speaks", () => {
  it("runs the tool, feeds the result back, and speaks on the next pass", async () => {
    const research = vi.fn(async () => "The warehouse must be resumed first.");
    const { client, requests } = fakeClient([
      { tool: "search_web", inputChunks: ['{"query":"warehouse not running"}'] },
      {
        tool: "say",
        inputChunks: ['{"action":"instruct","instruction":"Resume the warehouse."}'],
      },
    ]);

    const opts = baseOpts(client);
    const result = await runAgentTurn({ ...opts, deps: deps({ research }) });

    expect(research).toHaveBeenCalledWith("warehouse not running");
    expect(result.toolsUsed).toEqual(["search_web"]);
    expect(result.instruction).toBe("Resume the warehouse.");
    // The second request carries the assistant turn plus the tool_result.
    expect(requests).toHaveLength(2);
    const second = requests[1].messages as Anthropic.Messages.MessageParam[];
    expect(JSON.stringify(second)).toContain("The warehouse must be resumed first.");
  });

  it("never reads a mid-turn tool's input aloud", async () => {
    const chunks: SpeechChunk[] = [];
    const { client } = fakeClient([
      { tool: "search_web", inputChunks: ['{"query":"Is this spoken? No."}'] },
      { tool: "say", inputChunks: ['{"action":"instruct","instruction":"Done."}'] },
    ]);

    await runAgentTurn(baseOpts(client, (c) => chunks.push(c)));

    expect(chunks.map((c) => c.text)).toEqual(["Done."]);
  });

  it("a failing tool degrades the turn instead of ending it", async () => {
    // A dead network must never take the coach offline — the agent still has
    // to say something.
    const research = vi.fn(async () => {
      throw new Error("network down");
    });
    const { client, requests } = fakeClient([
      { tool: "search_web", inputChunks: ['{"query":"anything"}'] },
      {
        tool: "say",
        inputChunks: ['{"action":"instruct","instruction":"Let\'s try restarting it."}'],
      },
    ]);

    const opts = baseOpts(client);
    const result = await runAgentTurn({ ...opts, deps: deps({ research }) });

    expect(result.instruction).toBe("Let's try restarting it.");
    const second = requests[1].messages as Anthropic.Messages.MessageParam[];
    expect(JSON.stringify(second)).toContain("network down");
  });

  it("withdraws a failed tool for the rest of the turn and says so", async () => {
    // A timed-out search handed back as a bare "Tool failed" was retried
    // verbatim — two 20 s silences back to back. The tool must vanish from
    // the next request and the error must tell the model not to try again.
    const research = vi.fn(async () => {
      throw new Error("research_timeout");
    });
    const { client, requests } = fakeClient([
      { tool: "search_web", inputChunks: ['{"query":"anything"}'] },
      { tool: "say", inputChunks: ['{"action":"instruct","instruction":"Ok."}'] },
    ]);

    const opts = baseOpts(client);
    await runAgentTurn({ ...opts, deps: deps({ research }) });

    const names = (requests[1].tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).not.toContain("search_web");
    expect(names).toContain("read_screen_region");
    const second = requests[1].messages as Anthropic.Messages.MessageParam[];
    expect(JSON.stringify(second)).toContain("do not call it again");
  });

  it("reports when a tool starts, with its input", async () => {
    const started: Array<[string, Record<string, unknown>]> = [];
    const { client } = fakeClient([
      { tool: "search_web", inputChunks: ['{"query":"warehouse not running"}'] },
      { tool: "say", inputChunks: ['{"action":"instruct","instruction":"Ok."}'] },
    ]);

    await runAgentTurn({
      ...baseOpts(client),
      onToolStart: (tool, input) => started.push([tool, input]),
    });

    expect(started).toEqual([["search_web", { query: "warehouse not running" }]]);
  });

  it("carries a code block in history text so the model can resend it", async () => {
    const { client, requests } = fakeClient([
      { tool: "wait", inputChunks: ["{}"] },
    ]);
    const opts = baseOpts(client);
    await runAgentTurn({
      ...opts,
      ctx: {
        ...opts.ctx,
        conversation: [
          { role: "user", content: "Goal: add a workflow", timestamp: 0 },
          {
            role: "assistant",
            content: "Paste this into the editor.",
            code: "name: CI\non: [push]",
            timestamp: 1,
          },
        ],
      },
    });
    const msgs = requests[0].messages as Anthropic.Messages.MessageParam[];
    expect(msgs[1].content).toBe("Paste this into the editor.\n\nname: CI\non: [push]");
  });

  it("drops the mid-turn tools on the last permitted iteration", async () => {
    // Otherwise a model that keeps reaching for tools could spend the whole
    // budget and end the turn having said nothing.
    const { client, requests } = fakeClient([
      { tool: "search_web", inputChunks: ['{"query":"a"}'] },
      { tool: "search_web", inputChunks: ['{"query":"b"}'] },
      { tool: "say", inputChunks: ['{"action":"instruct","instruction":"Ok."}'] },
    ]);

    await runAgentTurn(baseOpts(client)); // tech support: maxToolIterations = 3

    const names = (requests[2].tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(["say", "wait"]);
  });
});

describe("the request is shaped for caching", () => {
  it("marks the system prompt as the cache breakpoint", async () => {
    const { client, requests } = fakeClient([
      { tool: "wait", inputChunks: ["{}"] },
    ]);
    await runAgentTurn(baseOpts(client));

    const system = requests[0].system as Array<Record<string, unknown>>;
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("forces exactly one tool per response", async () => {
    const { client, requests } = fakeClient([
      { tool: "wait", inputChunks: ["{}"] },
    ]);
    await runAgentTurn(baseOpts(client));

    expect(requests[0].tool_choice).toEqual({
      type: "any",
      disable_parallel_tool_use: true,
    });
  });
});
