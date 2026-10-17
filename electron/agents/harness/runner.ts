// The agent loop: one turn, start to finish.
//
//   build request → stream → model calls a tool
//     ├─ say/wait  → terminal. Parse it, return.
//     └─ anything else → run it, append the result, go again
//
// bounded by agent.maxToolIterations.
//
// Two things make this loop safe to run in front of a live voice coach:
//
// 1. SPEECH STREAMS OUT OF THE TOOL CALL ITSELF. The model's turn output IS a
//    `say` tool call, and Anthropic streams tool inputs as `input_json_delta`
//    — the same accumulating JSON text InstructionChunker already parses. So
//    TTS still starts on the first finished sentence, mid-generation, exactly
//    as it did before tools existed.
//
// 2. THE SILENCE GATE IS EXACT. The tool NAME arrives in `content_block_start`,
//    before any input text streams. A `wait` turn is therefore known silent
//    with nothing buffered and nothing to retract — strictly better than the
//    old approach of scanning accumulated text for an "action" key and holding
//    chunks until it appeared.
//
// `disable_parallel_tool_use` forces exactly one tool per response, which is
// what makes "did the turn end?" a single unambiguous check rather than a
// reconciliation between a terminal call and a lookup in the same response.

import type Anthropic from "@anthropic-ai/sdk";
import type { ConversationTurn, InstructionResponse } from "../../types";
import { InstructionChunker, type SpeechChunk } from "../../speech-chunker";
import { extractJson, parseInstruction } from "../../instruction-parse";
import {
  EMPTY_USAGE,
  addUsage,
  estimateCostUsd,
  normalizeUsage,
  type TokenUsage,
} from "../../usage";
import { buildContextHeader } from "./context";
import { parseTerminalTool } from "./parse-turn";
import { midTurnTools, systemPrompt, toolDefinitions } from "./schema";
import { asRateLimit } from "./errors";
import {
  SAY_TOOL,
  WAIT_TOOL,
  type Agent,
  type PlanDraft,
  type ToolDeps,
  type ToolOutput,
  type TurnContext,
} from "./types";

// Output ceiling per response. Output is billed only as generated, so this
// costs nothing when the model is brief — it is purely the room a turn has.
// It was 800, which a late-task `say` (a dozen completed steps re-listed,
// upcoming steps, notes, a memory, a highlight, sixty words of speech) could
// exceed; the SDK then hands back a PARTIAL tool input with no error, the
// truncated step list silently replaced the real one, and speech cut off
// mid-sentence. 2048 leaves headroom; a hit is also logged now.
const MAX_TOKENS = 2048;
/** Previous frame + latest frame. See the note in claude.ts on frame budget. */
const MAX_FRAMES = 2;
/** Text-only history turns sent with each tick. */
const MAX_HISTORY_TURNS = 10;
// One streamed response. The SDK's default is ten minutes with retries, which
// is how a single hung request used to take the coach offline for half an
// hour with nothing in the log. A vision turn normally finishes in 5-15 s.
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Tool result handed back for a `wait` that recorded a newly completed step
 * (see Agent.speakOnStepComplete). Written as a situation, not a scolding:
 * the model's step bookkeeping was right, only the silence was wrong.
 */
const SPEAK_ON_STEP_COMPLETE = `You recorded a newly completed step but called wait. The user just finished what you asked and is now waiting to hear from you — silence here feels like you stopped watching. Call say now: a 2-4 word acknowledgment, then the next step (action=instruct); or action=done if the goal is visibly achieved; or action=acknowledge if the screen shows something still in progress they should let finish. Only call wait again if they are already visibly working on the next step.`;

export interface RunTurnOptions {
  client: Anthropic;
  model: string;
  agent: Agent;
  ctx: TurnContext;
  deps: ToolDeps;
  /** Re-encode a historical frame smaller. Injected to keep this Electron-free. */
  toContextResolution(dataUrl: string): string;
  /** Fires per finished sentence, mid-stream. Never fires for a `wait` turn. */
  onSpeechChunk?: (chunk: SpeechChunk) => void;
  /** Fires as a mid-turn tool starts running — the user is about to wait. */
  onToolStart?: (tool: string, input: Record<string, unknown>) => void;
  log(message: string): void;
}

export interface TurnResult extends InstructionResponse {
  /** Names of mid-turn tools the model used, in call order. */
  toolsUsed: string[];
  /** Plan edits requested this turn, for the caller to apply. */
  planEdits: PlanDraft["edits"];
}

type Block = Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam;

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function mediaTypeOf(dataUrl: string): ImageMediaType {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));/.exec(dataUrl);
  return (m?.[1] as ImageMediaType) ?? "image/png";
}

function imageBlock(dataUrl: string): Anthropic.Messages.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaTypeOf(dataUrl),
      data: stripDataUrlPrefix(dataUrl),
    },
  };
}

/** The opening user turn: context header, then the frames, then any follow-up. */
function buildUserBlocks(
  agent: Agent,
  ctx: TurnContext,
  toContextResolution: (dataUrl: string) => string,
): Block[] {
  // When the screen hasn't changed, the history frame is a duplicate that
  // costs full image prefill to show the model the same picture twice.
  const budget = ctx.screenChanged === false ? 1 : MAX_FRAMES;
  const frames = ctx.frames.slice(-budget);

  const blocks: Block[] = [
    { type: "text", text: buildContextHeader(agent, ctx, frames.length) },
  ];

  for (let i = 0; i < frames.length; i++) {
    const isLatest = i === frames.length - 1;
    // Only the latest frame has to be sharp enough to read a button label.
    const dataUrl = isLatest
      ? frames[i].dataUrl
      : toContextResolution(frames[i].dataUrl);
    blocks.push({
      type: "text",
      text: isLatest
        ? "Latest screenshot (most recent, full resolution):"
        : `Screenshot ${i + 1} of ${frames.length} (earlier, reduced resolution — for comparison only):`,
    });
    blocks.push(imageBlock(dataUrl));
  }

  // A stored earlier attempt (training's check-my-work) rides at context
  // resolution — its job is comparison, not label-reading.
  if (ctx.referenceFrame) {
    blocks.push({
      type: "text",
      text: "The user's PREVIOUS attempt at this task, from an earlier check (reduced resolution — compare against the latest screenshot):",
    });
    blocks.push(imageBlock(toContextResolution(ctx.referenceFrame)));
  }

  if (ctx.followUp && ctx.followUp.trim().length > 0) {
    blocks.push({ type: "text", text: `User follow-up: ${ctx.followUp.trim()}` });
  }

  return blocks;
}

function toolResultBlock(
  toolUseId: string,
  out: ToolOutput,
): Anthropic.Messages.ToolResultBlockParam {
  const content: Array<
    Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam
  > = [];
  if (out.text) content.push({ type: "text", text: out.text });
  if (out.imageDataUrl) content.push(imageBlock(out.imageDataUrl));
  if (content.length === 0) content.push({ type: "text", text: "(no result)" });
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
    ...(out.isError ? { is_error: true } : {}),
  };
}

interface StreamOutcome {
  message: Anthropic.Messages.Message;
  usage: TokenUsage;
}

/**
 * One request. Streams, routing `say` input deltas into the chunker so speech
 * starts before the response finishes.
 */
async function streamOnce(
  opts: RunTurnOptions,
  messages: Anthropic.Messages.MessageParam[],
  tools: ReturnType<typeof toolDefinitions>,
): Promise<StreamOutcome> {
  const { client, model, agent, onSpeechChunk } = opts;

  const stream = client.messages.stream(
    {
      model,
      max_tokens: MAX_TOKENS,
      // Cache breakpoint on the system prompt. Tools render BEFORE system, so
      // this one marker covers the tool definitions too — which is exactly why
      // the tool list has to stay a fixed literal per agent.
      system: [
        {
          type: "text",
          text: systemPrompt(agent),
          cache_control: { type: "ephemeral" },
        } as unknown as Anthropic.Messages.TextBlockParam,
      ],
      tools: tools as unknown as Anthropic.Messages.Tool[],
      // Exactly one tool per response: the model either looks something up or
      // ends its turn, never both. Makes "is the turn over?" a single check.
      tool_choice: {
        type: "any",
        disable_parallel_tool_use: true,
      } as unknown as Anthropic.Messages.ToolChoice,
      messages,
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  const chunker = new InstructionChunker();
  // Index of the `say` block, if this response is one. Only deltas carrying
  // this index feed the chunker — a mid-turn tool's input must never be read
  // aloud, and neither must a `wait`.
  let sayIndex = -1;
  let sayJson = "";

  for await (const event of stream) {
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "tool_use"
    ) {
      if (event.content_block.name === SAY_TOOL) sayIndex = event.index;
      continue;
    }
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta" &&
      event.index === sayIndex
    ) {
      sayJson += event.delta.partial_json;
      if (onSpeechChunk) {
        for (const chunk of chunker.push(sayJson)) onSpeechChunk(chunk);
      }
    }
  }

  if (sayIndex >= 0 && onSpeechChunk) {
    for (const chunk of chunker.finish()) onSpeechChunk(chunk);
  }

  const message = await stream.finalMessage();
  return { message, usage: normalizeUsage(message.usage) };
}

/**
 * The text-only history sent ahead of the current turn.
 *
 * The Messages API requires the first message to be a `user` turn. Only the
 * goal and typed follow-ups add user turns, while every spoken instruction
 * adds an assistant turn — so after ten or so instructions with no question
 * from the user, a naive tail slice is all-assistant and every request is
 * rejected with a 400 until the session is restarted. When the tail doesn't
 * open on a user turn, the most recent user turn before it (the goal, or the
 * last question) is prepended — the API merges consecutive same-role turns,
 * so the instruction history itself stays intact.
 */
export function historyMessages(
  conversation: readonly ConversationTurn[],
  limit = MAX_HISTORY_TURNS,
): Anthropic.Messages.MessageParam[] {
  const start = Math.max(0, conversation.length - limit);
  let tail = conversation.slice(start);
  if (tail.length === 0) return [];
  if (tail[0].role !== "user") {
    let anchor = -1;
    for (let i = start - 1; i >= 0; i--) {
      if (conversation[i].role === "user") {
        anchor = i;
        break;
      }
    }
    if (anchor >= 0) {
      tail = [conversation[anchor], ...tail];
    } else {
      const firstUser = tail.findIndex((t) => t.role === "user");
      if (firstUser < 0) return [];
      tail = tail.slice(firstUser);
    }
  }
  // A code block the coach handed over rides along in its turn, so "that
  // didn't paste right" can be answered by resending it rather than guessing.
  return tail.map((t) => ({
    role: t.role,
    content: t.code ? `${t.content}\n\n${t.code}` : t.content,
  }));
}

/** Run one full agent turn, including any mid-turn tool calls. */
export async function runAgentTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const { agent, ctx, deps, model, log } = opts;
  const tools = toolDefinitions(agent);
  const toolsByName = new Map(midTurnTools(agent).map((t) => [t.name, t]));

  const messages: Anthropic.Messages.MessageParam[] = [
    // History is text-only; vision frames ride on the current turn.
    ...historyMessages(ctx.conversation),
    {
      role: "user",
      content: buildUserBlocks(agent, ctx, opts.toContextResolution),
    },
  ];

  const toolsUsed: string[] = [];
  // A tool that failed this turn is withdrawn for the rest of it. A timed-out
  // search handed back as "Tool failed" used to be retried verbatim, doubling
  // the silence the user sat through.
  const failedTools = new Set<string>();
  // One bounce per turn. If the model waits again after being asked to
  // speak, that is its answer — looping would burn the whole iteration
  // budget on the same question.
  let bounced = false;
  let usage: TokenUsage = { ...EMPTY_USAGE };

  // A turn cut off by max_tokens arrives as a PARTIAL tool input. Whatever
  // was said has already been spoken, but the bookkeeping fields can't be
  // trusted — a half-written step list must not replace the real one.
  const finish = (parsed: InstructionResponse, truncated: boolean): TurnResult => {
    if (truncated) {
      log(
        `[agent:${agent.id}] response hit max_tokens (${MAX_TOKENS}) — keeping the previous step list`,
      );
      parsed = {
        ...parsed,
        completedSteps: ctx.completedSteps,
        upcomingSteps: ctx.upcomingSteps,
      };
    }
    return {
      ...parsed,
      usage,
      model,
      costUsd: estimateCostUsd(model, usage),
      toolsUsed,
      planEdits: deps.planDraft.edits,
    };
  };

  try {
    for (let iteration = 0; iteration < agent.maxToolIterations; iteration++) {
      // On the final permitted iteration the model must finish, so drop the
      // mid-turn tools from the request. Removing tools mid-conversation costs
      // the cache, but this only fires on a turn that already spent its whole
      // budget looking things up — a rare path, and finishing beats caching.
      const lastChance = iteration === agent.maxToolIterations - 1;
      const activeTools = lastChance
        ? tools.filter((t) => t.name === SAY_TOOL || t.name === WAIT_TOOL)
        : tools.filter((t) => !failedTools.has(t.name));
      if (lastChance && toolsByName.size > 0) {
        log(`[agent:${agent.id}] tool budget spent — forcing a terminal turn`);
      }

      const { message, usage: turnUsage } = await streamOnce(
        opts,
        messages,
        activeTools,
      );
      usage = addUsage(usage, turnUsage);
      const truncated = message.stop_reason === "max_tokens";

      const toolUse = message.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );

      // No tool call at all. tool_choice:"any" should make this impossible,
      // but a schema-rejected turn or a refusal lands here. If the text is
      // the old-style JSON blob, read it; otherwise end the turn silently —
      // speaking the raw text (or inventing "continue with the next step",
      // as the old fallback did) is worse than one quiet tick, and the stall
      // ladder recovers on its own.
      if (!toolUse) {
        const text = message.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        log(
          `[agent:${agent.id}] no tool call (stop=${message.stop_reason}) — ${extractJson(text) ? "parsing text as JSON" : "ending the turn silently"}`,
        );
        return finish(
          extractJson(text)
            ? parseInstruction(text, ctx.completedSteps)
            : parseTerminalTool(WAIT_TOOL, {}, ctx.completedSteps),
          truncated,
        );
      }

      if (toolUse.name === SAY_TOOL || toolUse.name === WAIT_TOOL) {
        const parsed = parseTerminalTool(
          toolUse.name,
          (toolUse.input ?? {}) as Record<string, unknown>,
          ctx.completedSteps,
        );
        // A silent turn that just marked a step done is the one silence the
        // user always notices: they did what was asked and are now looking at
        // the panel for what's next. Hand the wait back once and ask for
        // speech — same turn, no re-capture, no extra tick.
        if (
          toolUse.name === WAIT_TOOL &&
          agent.speakOnStepComplete &&
          !bounced &&
          !lastChance &&
          !truncated &&
          parsed.completedSteps.length > ctx.completedSteps.length
        ) {
          bounced = true;
          log(
            `[agent:${agent.id}] wait recorded a newly completed step — asking for speech instead`,
          );
          messages.push({ role: "assistant", content: message.content });
          messages.push({
            role: "user",
            content: [
              toolResultBlock(toolUse.id, { text: SPEAK_ON_STEP_COMPLETE }),
            ],
          });
          continue;
        }
        return finish(parsed, truncated);
      }

      // Mid-turn tool. Run it, feed the result back, go again.
      const tool = toolsByName.get(toolUse.name);
      toolsUsed.push(toolUse.name);
      const input = (toolUse.input ?? {}) as Record<string, unknown>;
      let out: ToolOutput;
      if (!tool) {
        out = { text: `Unknown tool "${toolUse.name}".`, isError: true };
      } else {
        opts.onToolStart?.(toolUse.name, input);
        const startedAt = Date.now();
        try {
          out = await tool.run(input, deps);
          log(
            `[agent:${agent.id}] tool ${toolUse.name} ok in ${Date.now() - startedAt}ms` +
              (out.imageDataUrl ? " (+image)" : ""),
          );
        } catch (err) {
          // A failed tool must never fail the turn — the agent still has to
          // say something. Hand the error back and let it adapt.
          const msg = err instanceof Error ? err.message : String(err);
          log(`[agent:${agent.id}] tool ${toolUse.name} FAILED: ${msg}`);
          failedTools.add(toolUse.name);
          out = {
            text: `Tool failed: ${msg}. ${toolUse.name} is unavailable for the rest of this turn — do not call it again. Answer from what you can see and already know.`,
            isError: true,
          };
        }
      }

      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: [toolResultBlock(toolUse.id, out)] });
    }
  } catch (err) {
    const rate = asRateLimit(err);
    if (rate) throw rate;
    throw err;
  }

  // maxToolIterations must be >= 1 for the loop above to run at all.
  throw new Error(
    `Agent "${agent.id}" has maxToolIterations=${agent.maxToolIterations}; it must be at least 1.`,
  );
}
