// Builds the per-turn context header — the text block that leads the user
// message on every tick.
//
// This is the ONLY place per-tick data belongs. The system prompt and the tool
// definitions are byte-stable across a session so they stay cached; anything
// that changes tick to tick (timings, the last instruction, stall guidance)
// goes here, after the cache breakpoint.
//
// The base blocks below are agent-agnostic. Everything mode-specific arrives
// through skills' contextBlocks() — so the verify skill contributes the
// expected-result reminder, the memory skill contributes recalled facts, and
// an agent that lacks those skills simply never emits them.

import type { Agent, TurnContext } from "./types";

/** Blocks every agent gets, before any skill contributes. */
function baseBlocks(ctx: TurnContext, frameCount: number): string[] {
  const stepsList =
    ctx.completedSteps.length === 0
      ? "(none yet)"
      : ctx.completedSteps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");

  const parts = [
    `Original goal: ${ctx.goal}`,
    `Steps already completed:\n${stepsList}`,
    `Attached screenshots: ${frameCount} (oldest to newest).`,
  ];

  if (ctx.clarificationContext && ctx.clarificationContext.trim().length > 0) {
    parts.push(`Answers to clarifying questions:\n${ctx.clarificationContext}`);
  }
  if (ctx.uploadedContext && ctx.uploadedContext.trim().length > 0) {
    parts.push(
      `Reference material the user attached:\n${ctx.uploadedContext.trim()}`,
    );
  }

  const lastAssistant = [...ctx.conversation]
    .reverse()
    .find((t) => t.role === "assistant");
  if (lastAssistant) {
    // Deliberately tells the model to WAIT when the step isn't done yet. The
    // previous wording ("give a small additional hint") had the coach
    // rephrasing a step three seconds after finishing saying it — the user
    // hadn't had time to move. A different hint is only right once the
    // timing below says the screen has been still a long while.
    parts.push(
      `Your previous instruction was: "${lastAssistant.content.trim()}".\n` +
        `If the latest screenshot shows the user has NOT acted on it yet, the right move is almost always wait — they're reading, looking for it, or on their way. Don't repeat or rephrase it. Only once the screen has been still a long time (see the timing below and any stall guidance) give one different, smaller hint or ask a brief question.`,
    );
  }

  if (
    ctx.secondsSinceScreenChange !== undefined ||
    ctx.secondsSinceLastSpoke !== undefined
  ) {
    const timing: string[] = [];
    if (ctx.secondsSinceScreenChange !== undefined) {
      timing.push(`screen last changed ${ctx.secondsSinceScreenChange}s ago`);
    }
    if (ctx.secondsSinceLastSpoke !== undefined) {
      timing.push(`you last spoke ${ctx.secondsSinceLastSpoke}s ago`);
    }
    parts.push(`Timing: ${timing.join("; ")}.`);
  }

  return parts;
}

/**
 * Assemble the full context header: base blocks, then each skill's blocks in
 * skill order, then situational guidance, then the closing instruction.
 */
export function buildContextHeader(
  agent: Agent,
  ctx: TurnContext,
  frameCount: number,
): string {
  const parts = baseBlocks(ctx, frameCount);

  for (const skill of agent.skills) {
    if (!skill.contextBlocks) continue;
    for (const block of skill.contextBlocks(ctx)) {
      if (block && block.trim().length > 0) parts.push(block.trim());
    }
  }

  // Situational guidance last, so it reads as the most recent instruction —
  // it exists to override the agent's default pacing for this one turn.
  if (ctx.stalled) parts.push(agent.guidance.stalled);
  if (ctx.sessionJustStarted) parts.push(agent.guidance.sessionStart);
  if (ctx.followUp && ctx.followUp.trim().length > 0) {
    parts.push(agent.guidance.followUp);
  }

  parts.push(agent.nextTurnPrompt);
  return parts.join("\n\n");
}
