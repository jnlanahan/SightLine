import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { hashFrame, hashDistance, hashesAreSimilar } from "../lib/frameHash";
import { shouldCallClaude, type TickReason } from "../lib/loopGate";
import { instructionsAreSimilar, isRepeatedSentence } from "../lib/repeatGuard";
import { budgetStatus, cacheHitRate, formatUsd } from "../../electron/usage";
import {
  openSpeechStream,
  randomAckPhrase,
  randomCompletionPhrase,
  randomLookupPhrase,
  randomNoAnswerPhrase,
  randomThinkingPhrase,
  waitForSpeechEnd,
  isSpeaking,
  type SpeechStream,
} from "./useTts";
import { useQuietPeriod } from "./useQuietPeriod";
import { ensureAgentPolicy } from "../lib/agentPolicy";
import { liveNotes } from "../../electron/chat-notes";
import { takeFirstWords } from "../lib/askClock";
import { isQuickReply } from "../lib/quickReplies";
import type { Stance, StepPace } from "../lib/api";

const RETRY_DELAY_MS = 10_000;

// How long the loop waits before retrying after it could not get a policy
// from the agent. Only reachable if the main process is unhealthy.
const POLICY_RETRY_MS = 5_000;

// Screen still this long → use the agent's slow backstop instead of its
// normal one. This is the scheduler's own hysteresis, not the agent's
// cadence, so it stays here rather than crossing the bridge.
const SLOW_AFTER_MS = 120_000;

// A capture can fail transiently (display hot-plug mid-recalibration, a
// locked screen). The loop backs off and retries; only this many failures in
// a row escalate to the "error" state that stops the chain.
const CAPTURE_FAILURES_BEFORE_ERROR = 3;

// The runner sends at most this many frames to the model (previous + latest).
// Sending more across the bridge is pure IPC cost — each frame is a 1280 px
// base64 JPEG — so the renderer slices before the call. The store's 5-frame
// buffer still serves the peek overlay.
const FRAMES_PER_CALL = 2;

// The polling cadence itself belongs to the coach (electron/agents/coach.ts
// → Agent.loop / loopByStance), fetched once via agent:describe.
//
// What has NOT changed is why aggressive polling is safe: looking more often
// is NOT the same as talking more often. The agent's most common turn by a
// wide margin is `wait`, and speech is separately gated on
// isSpeaking()/waitForSpeechEnd(). A tighter quiet period costs tokens, not
// interruptions, and the budget guardrails (electron/usage.ts) bound that.
//
// The upper bound on how long a tick can take is also the agent's now: a turn
// may spend up to Agent.maxToolIterations round trips looking things up
// before it speaks. inFlightRef keeps those from overlapping.

// How long the screen must be still before a stall tick (which lets Claude
// check in), scaled by the expected pace of the current step.
const STALL_THRESHOLD_MS: Record<StepPace, number> = {
  quick: 18_000,
  medium: 45_000,
  long: 90_000,
};
const CHECK_IN_REPEAT_MS = 60_000;
// A digression normally suppresses stall check-ins (don't pester someone on a
// break) — but if the screen has been STILL this long while "diverted", the
// digression call was probably wrong (e.g. watching the wrong monitor), so
// let a check-in through rather than staying silent forever.
const DIVERTED_STALL_MS = 120_000;

export function useSessionLoop(onNeedsApiKey: () => void) {
  const inFlightRef = useRef(false);
  const captureFailuresRef = useRef(0);
  // When the user last clicked or typed on THEIR screen (as reported by the
  // main process, which already filters out clicks on this panel). A
  // highlight is computed from a frame captured seconds earlier; if they've
  // acted since, the box is pointing at a stale screen and is better not
  // drawn. The event's own timestamp is used, not arrival time — delivery is
  // debounced, and arrival time made inputs from before the capture look like
  // ones from after it.
  const lastInputAtRef = useRef(0);
  useEffect(() => {
    return api().input.onActivity((ev) => {
      lastInputAtRef.current = ev.at;
    });
  }, []);
  const tickRef = useRef<(reason: TickReason) => Promise<void>>(
    async () => {},
  );

  const tick = useCallback(
    async (reason: TickReason) => {
      const log = (msg: string) => api().log(`[loop] ${msg}`);
      if (inFlightRef.current) {
        log(`tick(${reason}) skipped: previous tick still in flight`);
        return;
      }
      // Claimed BEFORE the first await. The policy fetch below can yield to
      // the event loop, and a follow-up or input tick arriving in that window
      // used to pass this guard and run a second capture + Claude call.
      inFlightRef.current = true;

      // One speech stream per tick: the thinking filler (if any) plays first,
      // then instruction sentences queue behind it as they stream in — nothing
      // gets hard-cancelled mid-word within the same response. (Holder object
      // because TS flow analysis can't see closure assignments to a `let`.)
      const speech: { stream: SpeechStream | null } = { stream: null };
      let unsubEarly: (() => void) | null = null;
      let unsubTool: (() => void) | null = null;
      // The reopen greeting this look consumed, until its answer is actually
      // applied. A look that fails, throws, or is discarded has not greeted
      // anyone, so the finally block hands the greeting back for the next one.
      let undeliveredResume: {
        chatId: string | null;
        resume: { awayMinutes: number; whereWeLeftOff: string };
      } | null = null;
      const ttsOn = () => Boolean(useSettings.getState().settings?.ttsEnabled);
      let supersededLogged = false;
      const speakOut = (text: string) => {
        if (!ttsOn() || !text.trim()) return;
        // The user asked something NEW while this turn was in flight (their
        // follow-up cancelled our audio). Answering the old question now would
        // talk over the one they actually asked — stay quiet and let the next
        // tick answer them.
        if (useSession.getState().pendingFollowUp) {
          if (!supersededLogged) {
            supersededLogged = true;
            log("speech withheld: a newer follow-up is pending");
          }
          return;
        }
        if (!speech.stream) speech.stream = openSpeechStream();
        speech.stream.enqueue(text);
      };

      try {
        const state = useSession.getState();
        if (state.status !== "watching") return;
        if (!state.goal) return;

        // The user is mid-sentence on the mic. Nothing this tick could produce
        // is worth talking over them, and the answer would be stale the moment
        // they finish — the release of the key fires its own tick.
        if (state.listening || state.transcribing) {
          log(`tick(${reason}) skipped: user is speaking`);
          return;
        }

        const now = Date.now();
        if (state.rateLimitUntil && now < state.rateLimitUntil) {
          log(
            `tick(${reason}) skipped: rate-limited for ${Math.round((state.rateLimitUntil - now) / 1000)}s more`,
          );
          return;
        }

        // Budget guardrail. Checked before the call, not after, so the cap is
        // actually a cap. A limit of 0 disables it entirely — see budgetStatus.
        const budget = budgetStatus(
          state.costUsd,
          useSettings.getState().settings?.sessionBudgetUsd ?? 0,
        );
        if (budget.level === "exceeded") {
          log(
            `tick(${reason}) BLOCKED: session budget reached (${formatUsd(state.costUsd)} of ${formatUsd(budget.limitUsd)})`,
          );
          useSession.getState().setError(
            `Session budget reached (${formatUsd(state.costUsd)}). Raise the limit in Settings to keep going.`,
          );
          useSession.getState().setStatus("paused");
          return;
        }

        // The agent's cadence, fetched once per session. Without it we have no
        // basis for any timing decision below, so skip rather than guess.
        const cfg = await ensureAgentPolicy(state.stance);
        if (!cfg) {
          log(`tick(${reason}) skipped: agent policy unavailable`);
          return;
        }

        // Minimum spacing between Claude calls. Stamped when the call is made,
        // so a skipped or deduped response can never wedge the loop. A pending
        // follow-up bypasses the spacing — a direct question deserves a direct
        // answer, not "in a few seconds".
        if (
          state.lastClaudeCallAt &&
          now - state.lastClaudeCallAt < cfg.minCallSpacingMs &&
          !state.pendingFollowUp
        ) {
          log(
            `tick(${reason}) skipped: call spacing (${now - state.lastClaudeCallAt}ms < ${cfg.minCallSpacingMs}ms)`,
          );
          return;
        }

        // 1. Capture frame
        const displayId =
          useSettings.getState().settings?.selectedDisplayId ?? null;
        let frame;
        try {
          frame = await api().capture.once(displayId);
          captureFailuresRef.current = 0;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          captureFailuresRef.current += 1;
          const n = captureFailuresRef.current;
          log(`capture FAILED (${n}/${CAPTURE_FAILURES_BEFORE_ERROR}): ${msg}`);
          useSession.getState().setError(
            `Capture failed: ${msg}. Check screen-recording permission.`,
          );
          if (n >= CAPTURE_FAILURES_BEFORE_ERROR) {
            // Repeated failure is a real problem (permission, no source) —
            // stop the chain and show the error rather than spinning.
            useSession.getState().setStatus("error");
          } else {
            // One bad grab must not end the session: stay watching and let
            // the chain retry after a short back-off.
            useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
          }
          return;
        }
        useSession.getState().pushFrame(frame);

        // 2. Screen-change detection — filters cursor jitter, blinking carets.
        const newHash = await hashFrame(frame.dataUrl);
        const lastHash = useSession.getState().lastProcessedHash;
        const distance = hashDistance(newHash, lastHash ?? "");
        const screenChanged = !hashesAreSimilar(newHash, lastHash ?? "");
        // Re-read the clock: capture + hashing took real time, and the pacing
        // math below should measure from when we actually looked.
        const lookedAt = Date.now();
        if (screenChanged) {
          useSession.getState().setLastScreenChangeAt(lookedAt);
        }
        const s0 = useSession.getState();
        const hasPendingFollowUp = Boolean(s0.pendingFollowUp);

        const sinceChangeMs = lookedAt - (s0.lastScreenChangeAt ?? lookedAt);
        const sinceSpokeMs = lookedAt - (s0.lastSpokeAt ?? lookedAt);

        // Stall ladder: when the screen has been still longer than the current
        // step should take (pace-scaled), proceed anyway so Claude can look and
        // either stay silent ("wait") or check in. Suppressed while the user is
        // off on a digression and rate-limited to one check-in per minute.
        const stallThresholdMs = STALL_THRESHOLD_MS[s0.currentPace];
        const stalled =
          cfg.stallEnabled &&
          (!s0.diverted || sinceChangeMs >= DIVERTED_STALL_MS) &&
          s0.lastSpokeAt !== null &&
          sinceChangeMs >= stallThresholdMs &&
          sinceSpokeMs >= stallThresholdMs &&
          (!s0.lastCheckInAt || lookedAt - s0.lastCheckInAt >= CHECK_IN_REPEAT_MS);

        const gate = shouldCallClaude({
          reason,
          requireScreenChange: cfg.requireScreenChange,
          screenChanged,
          screenDistance: distance,
          hasPendingFollowUp,
          stalled,
        });
        if (!gate.proceed) {
          log(
            `tick(${reason}) skipped: ${gate.why} sinceChange=${Math.round(sinceChangeMs / 1000)}s sinceSpoke=${Math.round(sinceSpokeMs / 1000)}s diverted=${s0.diverted}`,
          );
          return;
        }

        // 3. Ask Claude. We deliberately do NOT cancel any in-flight TTS here
        //    — the peek phrase should keep playing while Claude thinks.
        useSession.getState().setLastClaudeCallAt(lookedAt);
        useSession.getState().setStatus("thinking");
        const s = useSession.getState();
        // Identity of the session this call belongs to. Pause, Stop, and Done
        // can all land while the request is in flight; the result is only
        // applied if the session is still the same one and still waiting on us.
        const sessionId = s.sessionId;

        // Consume pending follow-up
        const followUp = s.pendingFollowUp ?? undefined;
        if (s.pendingFollowUp) {
          useSession.getState().setPendingFollowUp(null);
        }
        // The user asked something this turn. The two anti-repetition guards
        // below are about not talking unprompted, and neither applies once
        // they've prompted us: saying an answer again because they asked for it
        // is correct, and going quiet leaves their question hanging.
        const answeringFollowUp = Boolean(followUp);

        // A reopened chat: this look greets the user with where things stood.
        // Consumed here so it happens exactly once.
        const resuming = s.resumePending ?? undefined;
        if (resuming) useSession.getState().setResumePending(null);
        if (resuming) undeliveredResume = { chatId: sessionId, resume: resuming };
        // Turns the user is waiting on. The two anti-repetition guards below
        // exist to stop UNPROMPTED repeats; a greeting that mentions the step
        // they were on is not one.
        const prompted = answeringFollowUp || Boolean(resuming);

        // First look after session start: the model is told to give the first
        // step immediately (never "wait", never a false "digression").
        const sessionJustStarted = !s.conversation.some(
          (t) => t.role === "assistant",
        );

        // Speed baseline: how long the user waited for the first words of the
        // answer to what they submitted — their goal (first look) or a
        // follow-up. Unprompted turns answer nothing and report nothing.
        const answersAsk = answeringFollowUp || sessionJustStarted;
        const noteFirstWords = (via: "stream" | "result") => {
          if (!answersAsk) return;
          const waited = takeFirstWords(Date.now());
          if (waited) {
            api().log(
              `[timing] first words ${waited.ms}ms after ${waited.kind} (${via})`,
            );
          }
        };

        // The user asked a direct question and is now waiting on a multi-second
        // vision call. A short spoken filler ("Let me take a look.") bridges the
        // gap; the answer queues behind it in the same stream. Skipped while
        // other audio is playing so we never cut ourselves off.
        // A one-tap reply ("I did this", "Check my work") told the coach
        // something rather than asking it something, so it gets a plain
        // acknowledgement instead of a filler that sounds like an answer.
        if (followUp && !isSpeaking()) {
          speakOut(isQuickReply(followUp) ? randomAckPhrase() : randomThinkingPhrase());
        }

        // Subscribe to sentence-level speech chunks — the first one fires as
        // soon as the first sentence of the instruction exists in the Claude
        // stream (never for "wait"), so speech starts while Claude is still
        // writing the rest.
        //
        // Repeat suppression has to happen HERE rather than on the finished
        // response: by the time the full result arrives every sentence has
        // already been enqueued and the user has heard it. Chunks are judged
        // one at a time, so a turn that pairs a new sentence with a repeated
        // one still speaks the new half.
        let earlySpoken = false;
        let suppressedRepeat = false;
        const previousInstruction = s.lastSpokenInstruction ?? "";
        unsubEarly = api().claude.onSpeechChunk((chunk) => {
          if (!ttsOn()) return;
          // The session moved on (paused, stopped) while the stream was
          // running — nothing from this turn should be heard.
          const live = useSession.getState();
          if (live.sessionId !== sessionId || live.status !== "thinking") return;
          // While the user is off on a digression, stay quiet — the full
          // response handler below decides if there's something new to say.
          if (live.diverted) return;
          if (!prompted && isRepeatedSentence(chunk.text, previousInstruction)) {
            log(`repeat sentence suppressed: "${chunk.text.slice(0, 40)}"`);
            suppressedRepeat = true;
            return;
          }
          speakOut(chunk.text);
          earlySpoken = true;
          noteFirstWords("stream");
          useSession.getState().setLastSpokeAt(Date.now());
        });

        // A mid-turn tool is the one stretch of a turn that can run long
        // (a web search is bounded at 10 s) with nothing streaming. Show it,
        // and for a search say so — a silent spinner reads as a freeze.
        unsubTool = api().claude.onToolStart((ev) => {
          const live = useSession.getState();
          if (live.sessionId !== sessionId || live.status !== "thinking") return;
          log(`tool ${ev.tool} started${ev.detail ? `: "${ev.detail.slice(0, 60)}"` : ""}`);
          useSession.getState().setActiveTool({ name: ev.tool, detail: ev.detail });
          if (ev.tool === "search_web" && !isSpeaking() && !earlySpoken) {
            speakOut(randomLookupPhrase());
          }
        });

        log(
          `tick(${reason}) → Claude: ${gate.why} followUp=${followUp ? `"${followUp.slice(0, 40)}"` : "no"} stalled=${stalled} justStarted=${sessionJustStarted} stance=${s.stance}${resuming ? " resuming" : ""}`,
        );

        const callStartedAt = Date.now();

        const result = await api().claude.nextInstruction({
          stance: s.stance,
          goal: s.goal!,
          completedSteps: s.completedSteps,
          upcomingSteps: s.upcomingSteps,
          stages: s.stages,
          stageIndex: s.stageIndex,
          conversation: s.conversation,
          frames: s.frames.slice(-FRAMES_PER_CALL),
          followUp,
          uploadedContext: s.uploadedContext,
          // Only live notes: one the user forgot, or the cap retired, is gone
          // as far as the coach is concerned.
          agentNotes: liveNotes(s.agentNotes).map((n) => n.text),
          recalledMemory: s.recalledMemory,
          lastExpectedResult: s.lastExpectedResult ?? undefined,
          secondsSinceScreenChange: Math.round(sinceChangeMs / 1000),
          secondsSinceLastSpoke: s.lastSpokeAt
            ? Math.round(sinceSpokeMs / 1000)
            : undefined,
          stalled,
          sessionJustStarted,
          screenChanged,
          resuming,
          // The open chat, so a search of earlier chats leaves it out.
          chatId: sessionId,
        });

        // Handle error envelope
        if (result && typeof result === "object" && "__error" in result) {
          const err = result as {
            __error: string;
            retryAfterSec?: number;
            message?: string;
          };
          log(`Claude ERROR: ${err.__error} ${err.message ?? ""}`);
          const live = useSession.getState();
          if (live.sessionId !== sessionId || live.status !== "thinking") {
            log("error result discarded: session moved on");
            return;
          }
          if (err.__error === "missing_api_key") {
            useSession.getState().setStatus("paused");
            useSession.getState().setError(
              "No Anthropic API key. Put ANTHROPIC_API_KEY in the .env file, then restart SightLine.",
            );
            onNeedsApiKey();
            return;
          }
          if (err.__error === "rate_limited") {
            const wait = (err.retryAfterSec ?? 30) * 1000;
            useSession.getState().setRateLimit(Date.now() + wait);
            useSession.getState().setStatus("watching");
            useSession.getState().setError(
              `Rate limited. Backing off for ${err.retryAfterSec ?? 30}s.`,
            );
            return;
          }
          useSession.getState().setError(
            err.message ?? "Request failed. Retrying in 10s.",
          );
          useSession.getState().setStatus("watching");
          useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
          return;
        }

        // Token accounting. Logged with the cache hit rate because a rate that
        // collapses toward zero is the signature of a broken cached prefix —
        // the loop still works, it just silently costs several times more.
        // Recorded whenever the session is still the same one, even if the
        // result below is discarded — the money was spent either way.
        if (result.usage && useSession.getState().sessionId === sessionId) {
          useSession
            .getState()
            .recordUsage(result.usage, result.costUsd ?? 0);
          const s2 = useSession.getState();
          log(
            `usage in=${result.usage.inputTokens} out=${result.usage.outputTokens} ` +
              `cacheRead=${result.usage.cacheReadTokens} cacheWrite=${result.usage.cacheCreationTokens} ` +
              `hitRate=${Math.round(cacheHitRate(s2.usage) * 100)}% ` +
              `call=${formatUsd(result.costUsd ?? 0)} session=${formatUsd(s2.costUsd)} over ${s2.claudeCalls} calls`,
          );
        }

        log(
          `Claude ← action=${result.action} in ${Date.now() - callStartedAt}ms digression=${result.digression} troubleshooting=${result.troubleshooting} pace=${result.expectedPace} highlight=${result.highlight ? "yes" : "no"} instr="${(result.instruction ?? "").slice(0, 60)}"`,
        );

        // The user paused, stopped, or pressed Done while we were waiting.
        // Applying this result would overwrite their action (the old code set
        // status back to "watching" here, silently undoing a Pause) and could
        // write a dead session's steps into the store of the next one.
        {
          const live = useSession.getState();
          if (live.sessionId !== sessionId || live.status !== "thinking") {
            log(
              `result discarded: session ${live.sessionId !== sessionId ? "changed" : `is now "${live.status}"`}`,
            );
            return;
          }
        }

        // This look's answer is about to be applied, so a greeting it carried
        // has been delivered (the wait safety net below covers a silent one).
        undeliveredResume = null;

        // 4. Update state — these apply on EVERY action, including "wait",
        //    so Claude can mark progress silently.
        useSession.getState().setError(null);
        useSession.getState().setRateLimit(null);
        useSession.getState().setLastProcessedHash(newHash);
        useSession
          .getState()
          .applyCompletedSteps(result.completedSteps, Date.now());
        // A digression is a pause, not a new plan: whatever the turn sent,
        // the route is still there when the user comes back.
        if (!result.digression) {
          useSession.getState().setUpcomingSteps(result.upcomingSteps ?? []);
        }
        // After the steps: a step finished on the turn that moves to the next
        // stage belongs to the stage being left.
        if (result.stages || typeof result.stageNumber === "number") {
          useSession
            .getState()
            .applyStages(result.stages ?? null, result.stageNumber ?? null);
          const after = useSession.getState();
          log(
            `stage ${after.stageIndex + 1} of ${after.stages.length}: "${(after.stages[after.stageIndex] ?? "").slice(0, 50)}"`,
          );
        }
        useSession.getState().setTroubleshooting(Boolean(result.troubleshooting));
        // The coach changed how it is helping. Takes effect from the next
        // look: the cadence, the input trigger, and the finished-step bounce
        // all read the stance from the store.
        if (result.stance && result.stance !== useSession.getState().stance) {
          log(`stance ${useSession.getState().stance} → ${result.stance}`);
          useSession.getState().setStance(result.stance);
        }

        if (result.notes && result.notes.trim().length > 0) {
          useSession
            .getState()
            .appendAgentNote(result.notes.trim(), result.noteSeen === true, Date.now());
        }

        // A durable fact for FUTURE sessions. Persisted immediately rather
        // than at session end, so a crash or a force-quit doesn't lose what
        // the coach just learned about this person's setup.
        if (result.remember?.content) {
          const fact = result.remember;
          void api()
            .memory.add(fact.kind, fact.content, useSession.getState().sessionId, fact.seen)
            .then((res) => {
              log(
                res.added
                  ? `remembered (${fact.kind}${fact.seen ? ", seen" : ""}): ${fact.content}`
                  : `remember skipped (${res.reason ?? "disabled"}): ${fact.content}`,
              );
            })
            .catch((err: unknown) => {
              log(`remember FAILED: ${err instanceof Error ? err.message : String(err)}`);
            });
        }

        // Digression: user navigated away from the task. Speak the warm pause
        // message ONCE, then keep watching silently — the loop auto-resumes
        // when the screen shows the task again (no typed follow-up needed).
        if (result.digression) {
          const alreadyDiverted = useSession.getState().diverted;
          useSession.getState().setDiverted(true);
          if (!alreadyDiverted && result.instruction) {
            useSession.getState().setInstruction(result.instruction);
            useSession.getState().appendTurn({
              role: "assistant",
              content: result.instruction,
              timestamp: Date.now(),
            });
            useSession.getState().setLastSpokeAt(Date.now());
            if (!earlySpoken) speakOut(result.instruction);
          }
          useSession.getState().setStatus("watching");
          return;
        }
        // Any substantive response while diverted means the user is back on task.
        if (
          useSession.getState().diverted &&
          (result.action === "instruct" ||
            result.action === "acknowledge" ||
            result.action === "done")
        ) {
          useSession.getState().setDiverted(false);
        }

        if (sessionJustStarted && result.action === "wait") {
          log(
            "first tick returned wait despite sessionJustStarted — stall ladder will recover",
          );
        }

        // Dedupe safety net (instruct only): if Claude repeated itself
        // verbatim, treat it as a wait instead of speaking again. State and
        // call spacing are already stamped, so this can never wedge the loop.
        let action = result.action;
        if (
          !prompted &&
          action === "instruct" &&
          result.instruction &&
          instructionsAreSimilar(
            result.instruction,
            useSession.getState().lastSpokenInstruction ?? "",
          )
        ) {
          log("repeated instruction suppressed; treating as wait");
          action = "wait";
        }

        // A follow-up that resolves to "wait" is the one silence the user
        // always notices — they hear "Let me take a look." and then nothing.
        // The prompt forbids it, so this is the belt-and-braces path: say
        // whatever the model did produce, or a fixed phrase if it produced
        // nothing at all.
        let noAnswerFallback: string | null = null;
        if (answeringFollowUp && action === "wait") {
          noAnswerFallback = result.instruction?.trim()
            ? null
            : randomNoAnswerPhrase();
          log(
            `follow-up returned wait — recovering with ${noAnswerFallback ? "a fixed phrase" : "the model's text"}`,
          );
          action = "acknowledge";
        }

        // The same net for the greeting on reopening a chat: the prompt says
        // it must be spoken, and a user who reopens a chat and hears nothing
        // assumes it did not come back.
        if (resuming && !answeringFollowUp && action === "wait") {
          const left = resuming.whereWeLeftOff.trim();
          noAnswerFallback = result.instruction?.trim()
            ? null
            : left
              ? `Welcome back. ${left}`
              : "Welcome back. Ready when you are.";
          log(
            `resume look returned wait — recovering with ${noAnswerFallback ? "the saved summary" : "the model's text"}`,
          );
          action = "acknowledge";
        }

        // Muted, or a reply that did not stream: the words exist from here.
        if (action !== "wait") noteFirstWords("result");

        switch (action) {
          case "wait":
            break;

          case "instruct": {
            useSession.getState().setInstruction(result.instruction, result.code);
            useSession.getState().appendTurn({
              role: "assistant",
              content: result.instruction,
              ...(result.code ? { code: result.code } : {}),
              timestamp: Date.now(),
            });
            useSession.getState().setLastSpokenInstruction(result.instruction);
            useSession.getState().setLastSpokeAt(Date.now());
            useSession.getState().setCurrentPace(result.expectedPace);
            useSession
              .getState()
              .setLastExpectedResult(result.expectedResult || null);
            // `suppressedRepeat` means we deliberately withheld sentences as
            // they streamed — re-speaking the full text here would undo that.
            if (!earlySpoken && !suppressedRepeat) speakOut(result.instruction);
            // Point at the thing to click: flash a glow box on the screen
            // over the element Claude identified — unless the user has acted
            // since the frame it was computed from, in which case the box is
            // pointing at a screen that no longer exists.
            if (result.highlight) {
              if (lastInputAtRef.current > lookedAt) {
                log("highlight skipped: user input since the frame was captured");
              } else {
                void api().overlay.flashHighlight(result.highlight);
              }
            }
            break;
          }

          case "acknowledge":
          case "check_in": {
            const text = noAnswerFallback ?? result.instruction;
            useSession.getState().appendTurn({
              role: "assistant",
              content: text,
              timestamp: Date.now(),
            });
            useSession.getState().setLastSpokeAt(Date.now());
            if (action === "check_in") {
              useSession.getState().setLastCheckInAt(Date.now());
            }
            if (!earlySpoken && !suppressedRepeat) speakOut(text);
            break;
          }

          case "done": {
            useSession.getState().setInstruction(result.instruction, result.code);
            useSession.getState().appendTurn({
              role: "assistant",
              content: result.instruction,
              ...(result.code ? { code: result.code } : {}),
              timestamp: Date.now(),
            });
            useSession.getState().setLastSpokenInstruction(result.instruction);
            useSession.getState().setLastSpokeAt(Date.now());
            useSession.getState().setDone(true);
            // If the instruction already streamed out, just add the wrap-up —
            // it queues behind the still-playing sentences.
            if (earlySpoken || suppressedRepeat) {
              speakOut(randomCompletionPhrase());
            } else {
              speakOut(`${result.instruction} ${randomCompletionPhrase()}`);
            }
            break;
          }
        }

        // "waiting" is reached ONLY when the goal is done — a legitimate stop.
        // submitFollowUp resumes from it.
        const restingStatus = action === "done" ? "waiting" : "watching";

        useSession.getState().setStatus(restingStatus);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`tick(${reason}) THREW: ${msg}`);
        const live = useSession.getState();
        // Only touch status if we are the ones who set it to "thinking" —
        // a throw after the user paused must not un-pause them.
        if (live.status === "thinking" || live.status === "watching") {
          useSession.getState().setError(msg);
          useSession.getState().setStatus("watching");
          useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
        }
      } finally {
        unsubEarly?.();
        unsubTool?.();
        if (useSession.getState().activeTool) {
          useSession.getState().setActiveTool(null);
        }
        if (
          undeliveredResume &&
          useSession.getState().sessionId === undeliveredResume.chatId
        ) {
          log("resume greeting not delivered — it will be tried again");
          useSession.getState().setResumePending(undeliveredResume.resume);
        }
        // Close the stream so waitForSpeechEnd() resolves once the queued
        // audio drains. Anything already enqueued still plays to the end.
        speech.stream?.end();
        inFlightRef.current = false;
      }
    },
    [onNeedsApiKey],
  );

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Main capture loop — one self-rescheduling chain per active session.
  //
  // The previous design stopped and restarted the chain on EVERY status
  // change; since each tick flips watching → thinking → watching, that
  // cancelled timers mid-flight, spawned overlapping chains, and could
  // resurrect a cancelled chain via the shared `cancelled` flag. Now:
  // - one chain, guarded by `running`
  // - "thinking" is part of a tick, never a reason to stop or start anything
  // - the chain exits by itself when the session leaves "watching", and the
  //   status watcher starts a fresh one when it returns
  useEffect(() => {
    let disposed = false;
    let running = false;
    let cancelSleep: (() => void) | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          cancelSleep = null;
          resolve();
        }, ms);
        cancelSleep = () => {
          window.clearTimeout(id);
          cancelSleep = null;
          resolve();
        };
      });

    async function runChain() {
      if (running) return;
      running = true;
      api().log("[loop] backstop chain started");
      try {
        while (!disposed) {
          if (useSession.getState().status !== "watching") break;

          // Never talk over ourselves: if audio is still playing (e.g. the
          // plan overview right after session start), let it finish before
          // looking at the screen — the capture is fresher afterwards anyway.
          await waitForSpeechEnd();
          if (disposed) break;

          const pendingBefore = useSession.getState().pendingFollowUp;
          const chatBefore = useSession.getState().sessionId;
          await tickRef.current("backstop");

          // The chat changed while that look was in flight (left one, opened
          // another). Its answer was discarded; the new chat has not been
          // looked at yet and must not wait out a full poll interval first.
          if (useSession.getState().sessionId !== chatBefore) continue;

          // A follow-up that arrived while that tick was in flight has been
          // waiting this whole time. Go straight back around rather than
          // sleeping a full poll interval on the user's question. Only a NEW
          // follow-up qualifies — one the tick saw and skipped (rate limit,
          // user on the mic) must wait for the normal cadence, or this would
          // spin.
          const pendingAfter = useSession.getState().pendingFollowUp;
          if (pendingAfter && pendingAfter !== pendingBefore) continue;

          // Wait for any TTS audio to finish before scheduling the next tick.
          await waitForSpeechEnd();
          if (disposed) break;

          const s = useSession.getState();
          if (s.status !== "watching") break;
          const cfg = await ensureAgentPolicy(s.stance);
          if (!cfg) {
            await sleep(POLICY_RETRY_MS);
            continue;
          }

          // After a long stretch with no screen change, slow the backstop.
          const sinceChangeMs = Date.now() - (s.lastScreenChangeAt ?? Date.now());
          const delayMs =
            sinceChangeMs > SLOW_AFTER_MS
              ? cfg.slowIntervalMs
              : cfg.normalIntervalMs;
          await sleep(delayMs);
        }
      } finally {
        running = false;
        api().log("[loop] backstop chain stopped");
      }
    }

    if (useSession.getState().status === "watching") void runChain();

    const unsub = useSession.subscribe((state, prev) => {
      // A different chat, or a different stance, makes the sleep in progress
      // the wrong length: it was chosen for the old one. Wake the chain so it
      // looks now and picks its next delay from the current state.
      if (state.sessionId !== prev.sessionId || state.stance !== prev.stance) {
        cancelSleep?.();
      }
      if (state.status === prev.status) return;
      if (state.status === "watching") {
        void runChain(); // no-op if the chain is already alive
      } else if (state.status !== "thinking") {
        // paused / waiting / error / idle — wake a sleeping chain so it
        // notices and exits now instead of ticking once more later.
        cancelSleep?.();
      }
    });

    return () => {
      disposed = true;
      cancelSleep?.();
      unsub();
    };
  }, []);

  // Fire a tick immediately whenever a follow-up is submitted, in either
  // stance — a direct question shouldn't wait for the next poll. A follow-up
  // submitted mid-"thinking" is picked up by the chain the moment that tick
  // ends (see runChain).
  useEffect(() => {
    const unsub = useSession.subscribe((state, prev) => {
      if (state.pendingFollowUp === prev.pendingFollowUp) return;
      if (!state.pendingFollowUp) return;
      if (state.status !== "watching") return;
      void tickRef.current("followup");
    });
    return unsub;
  }, []);

  // Digression recovery: when a follow-up arrives while the user is diverted,
  // clear the diverted flag so the UI returns to normal watching state.
  useEffect(() => {
    const unsub = useSession.subscribe((state, prev) => {
      if (state.pendingFollowUp === prev.pendingFollowUp) return;
      if (!state.pendingFollowUp) return;
      if (!state.diverted) return;
      useSession.getState().setDiverted(false);
    });
    return unsub;
  }, []);

  // The input trigger's debounce is the agent's, so it has to become state:
  // useQuietPeriod re-subscribes when the value changes, and it starts at 0
  // (disabled) until the agent has been described. It follows the stance too:
  // guiding reacts to the user's clicks, watching quietly does not.
  const [quietPeriodMs, setQuietPeriodMs] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = (sessionId: string | null, stance: Stance) => {
      // No open chat means nothing to react to (reset() clears the id when a
      // chat is left), so the input trigger stays disarmed between chats.
      if (!sessionId) {
        setQuietPeriodMs(0);
        return;
      }
      void ensureAgentPolicy(stance).then((policy) => {
        if (cancelled) return;
        // A slower describe for a previous chat or stance must not win the race.
        const live = useSession.getState();
        if (live.sessionId !== sessionId || live.stance !== stance) return;
        setQuietPeriodMs(policy?.quietPeriodMs ?? 0);
      });
    };
    load(useSession.getState().sessionId, useSession.getState().stance);
    const unsub = useSession.subscribe((state, prev) => {
      if (state.sessionId !== prev.sessionId || state.stance !== prev.stance) {
        load(state.sessionId, state.stance);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Input trigger: wait for the agent's quiet period of silence after user
  // activity, then fire a tick. A cadence with quietPeriodMs=0 (the watch
  // stance) never subscribes at all. Also skipped while the user is off on a
  // digression — the backstop covers re-checking until they return.
  useQuietPeriod(quietPeriodMs, () => {
    const s = useSession.getState();
    if (s.status !== "watching") return;
    if (s.diverted) return;
    // Don't fire a tick while TTS is actively playing — it would cancel the audio.
    if (isSpeaking()) return;
    // Nor while the user is holding the mic — the keystrokes that opened it
    // are exactly the "activity" that would otherwise trigger this.
    if (s.listening || s.transcribing) return;
    void tickRef.current("input");
  });
}
