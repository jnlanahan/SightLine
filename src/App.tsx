import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./store/session";
import { useSettings } from "./store/settings";
import { useSessionLoop } from "./hooks/useSessionLoop";
import { useRateLimitCountdown } from "./hooks/useRateLimitCountdown";
import { useTts } from "./hooks/useTts";
import { api } from "./lib/api";
import { Composer } from "./components/Composer";
import { ProgressRail, PlanList } from "./components/ProgressRail";
import { GoalPrompt } from "./components/GoalPrompt";
import { ModeSelect } from "./components/ModeSelect";
import type { AppMode, CaptureTarget, Clarification, DockSide, SessionStatus } from "./lib/api";
import { Instruction } from "./components/Instruction";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { Settings as SettingsView } from "./components/Settings";
import { DockRail } from "./components/DockRail";
import { ConversationHistory } from "./components/ConversationHistory";
import { buildSessionRecord, isWorthSaving } from "./lib/sessionRecord";
import { toPlanSteps, curriculumSteps } from "./lib/planSteps";
import { CurriculumOutline } from "./components/CurriculumOutline";
import { detailModuleInBackground } from "./lib/trainingProgress";
import {
  appendJournal,
  beginRun,
  buildWhereWeLeftOff,
  currentModule,
  currentTask,
} from "../electron/training-plan";
import { CHECK_MY_WORK_FOLLOW_UP, STUCK_FOLLOW_UP } from "../electron/types";
import type { TrainingPlan } from "./lib/api";
import { usePushToTalk } from "./hooks/usePushToTalk";
import { useTheme } from "./design/ThemeProvider";
import { Glow, Logo, Spinner, CtrlBtn } from "./design/primitives";
import {
  IPause,
  IGear,
  IExpand,
  IMonitor,
  IMinimize,
  IClose,
  ISpeakerOn,
  ISpeakerOff,
} from "./design/icons";
import { ar, lt } from "./design/theme";
import { budgetStatus, formatUsd } from "../electron/usage";

type View = "panel" | "settings" | "privacy";

const MODE_LABELS: Record<AppMode, string> = {
  tech_support: "Tech Support",
  training:     "Training",
  teacher:      "Teacher",
};

const MODE_META: Record<AppMode, { goalLabel: string; stepNoun: string }> = {
  tech_support: { goalLabel: "Goal", stepNoun: "step" },
  training:     { goalLabel: "Training plan for", stepNoun: "plan step" },
  teacher:      { goalLabel: "Learning", stepNoun: "topic" },
};

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle:        "Ready when you are",
  watching:    "Watching your screen",
  thinking:    "Thinking…",
  waiting:     "Done",
  paused:      "Paused",
  error:       "Error",
  clarifying:  "Setting up…",
  researching: "Looking that up…",
  evaluating:  "Checking your work…",
};

const STATUS_DOT: Record<SessionStatus, string> = {
  idle:        "#7B816D",
  watching:    "#4F8A2C",
  thinking:    "#C07C10",
  waiting:     "#4F8A2C",
  paused:      "#7B816D",
  error:       "#DB3B3B",
  clarifying:  "#C07C10",
  researching: "#C07C10",
  evaluating:  "#C07C10",
};

export default function App() {
  const status         = useSession((s) => s.status);
  const mode           = useSession((s) => s.mode);
  const goal           = useSession((s) => s.goal);
  const instruction    = useSession((s) => s.currentInstruction);
  const completedSteps = useSession((s) => s.completedSteps);
  const upcomingSteps  = useSession((s) => s.upcomingSteps);
  // Only WHETHER a frame exists is subscribed here. pushFrame creates a new
  // array on every tick, so subscribing to `frames` re-rendered the entire
  // tree every 15 s and on every input burst; the one component that shows
  // a frame (PeekOverlay) reads it itself.
  const hasFrame       = useSession((s) => s.frames.length > 0);
  const error          = useSession((s) => s.lastError);
  const done           = useSession((s) => s.done);
  const reset          = useSession((s) => s.reset);
  const setStatus      = useSession((s) => s.setStatus);
  const setMode        = useSession((s) => s.setMode);
  const setGoal        = useSession((s) => s.setGoal);
  const appendTurn     = useSession((s) => s.appendTurn);
  const researchQuery  = useSession((s) => s.researchQuery);
  const conversation   = useSession((s) => s.conversation);
  const attachedFileNames = useSession((s) => s.attachedFileNames);
  const agentNotes     = useSession((s) => s.agentNotes);
  const troubleshooting = useSession((s) => s.troubleshooting);
  const activePlan     = useSession((s) => s.activePlan);

  const settings      = useSettings((s) => s.settings);
  const keyStatus     = useSettings((s) => s.keyStatus);
  const loadSettings  = useSettings((s) => s.load);
  const patchSettings = useSettings((s) => s.patch);

  const [view, setView]                   = useState<View>("panel");
  const [focused, setFocused]             = useState(false);
  const [showPeek, setShowPeek]           = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [collapsed, setCollapsed]         = useState(false);
  const [docked, setDocked]               = useState(false);
  const [planOpen, setPlanOpen]           = useState(false);
  const [evalResult, setEvalResult]       = useState<{ achieved: boolean; verdict: string } | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  // When the current session began — the store holds progress, not wall-clock
  // start, and history needs a real duration.
  const sessionStartedAtRef = useRef<number | null>(null);

  // Keep the newest message (usually the current instruction) in view. Not
  // keyed on status: every Claude call flips watching → thinking → watching,
  // which yanked a user who had scrolled up to reread a step back down twice
  // per tick even when nothing new was said.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation.length, instruction, evalResult]);

  const rateLimitCountdown = useRateLimitCountdown();
  const { cancel: cancelTts } = useTts();

  const openSettings = useCallback(() => setView("settings"), []);
  useSessionLoop(openSettings);

  // Voice in. Declared before submitFollowUp exists, so the transcript is
  // routed through a ref-stable callback rather than capturing it.
  const submitFollowUpRef = useRef<(text: string) => void>(() => {});
  const { startTalking, stopTalking } = usePushToTalk((text) =>
    submitFollowUpRef.current(text),
  );

  // The single ordered plan, derived once and shared by the progress rail and
  // the step list so the two can never disagree about where you are. With a
  // training plan active, the curriculum is the plan — the loop's flat step
  // list is just the session's activity log.
  const planSteps = activePlan
    ? curriculumSteps(activePlan)
    : toPlanSteps({
        completedSteps,
        currentInstruction: instruction,
        upcomingSteps,
        done,
      });

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  // Coach Mode: track whether the window is currently a docked sidebar. The
  // main process is the source of truth — transitions can also happen without
  // the renderer asking (docked monitor unplugged, minimize while docked).
  useEffect(() => {
    void api().dock.state().then((s) => setDocked(s.docked));
    return api().dock.onChanged((s) => {
      setDocked(s.docked);
      // Undocking restores the expanded floating window — a leftover rail
      // state would render a 64px strip inside a full-size window.
      if (!s.docked) setCollapsed(false);
    });
  }, []);

  useEffect(() => {
    return api().overlay.onRegionUpdated(() => { void loadSettings(); });
  }, [loadSettings]);

  useEffect(() => {
    if (!settings) return;
    if (!settings.hasSeenPrivacyNotice) setView("privacy");
  }, [settings]);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur  = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur",  onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur",  onBlur);
    };
  }, []);

  const opacitySetting = settings?.opacity;
  useEffect(() => {
    if (opacitySetting === undefined || docked) return; // docked sidebar stays opaque
    const target = focused ? 1 : opacitySetting;
    void api().window.setOpacity(target);
  }, [focused, opacitySetting, docked]);

  // Ctrl+Q while SightLine has focus. This used to be a GLOBAL shortcut in
  // the main process, which quit the coach — without the mid-session
  // confirmation — whenever the user pressed Ctrl+Q in the program they were
  // being coached in. Scoped to this window it is just a normal quit key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "q") return;
      e.preventDefault();
      if (useSession.getState().goal) setShowQuitConfirm(true);
      else void api().app.quit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!showPeek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowPeek(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPeek]);

  // A new instruction means the user kept working — clear any stale
  // goal-evaluation verdict card.
  useEffect(() => {
    setEvalResult(null);
  }, [instruction]);

  async function toggleCollapsed() {
    const next = !collapsed;
    if (next) {
      // Resize first, then swap the UI, to minimize clipped-content flash.
      await api().window.setCollapsed(true);
      setCollapsed(true);
    } else {
      setCollapsed(false);
      await api().window.setCollapsed(false);
    }
  }

  function startSession(g: string, clarifications: Clarification[] = [], planSteps: string[] = []) {
    if (!keyStatus.anthropic) { setView("settings"); return; }
    const ctx = clarifications
      .filter((c) => c.answer.trim())
      .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
      .join("\n\n");
    const activeMode = useSession.getState().mode;
    reset();
    if (activeMode) setMode(activeMode);
    if (ctx) useSession.getState().setClarificationContext(ctx);
    if (planSteps.length > 0) useSession.getState().setUpcomingSteps(planSteps);
    setGoal(g);
    // Mint the id up front so anything the coach learns mid-session can be
    // attributed to it, even if the session never gets cleanly ended.
    const id = `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    useSession.getState().setSessionId(id);
    sessionStartedAtRef.current = Date.now();

    // Recall what we know about this user before the first look at the screen.
    // Fire-and-forget: memory is an enhancement, and waiting on disk I/O here
    // would delay the first instruction for no good reason. Worst case the
    // first tick goes out without it and every tick after has it.
    void api()
      .memory.recall(g)
      .then(({ text, facts }) => {
        if (!text) return;
        if (useSession.getState().sessionId !== id) return; // session changed
        useSession.getState().setRecalledMemory(text);
        api().log(`[memory] applied ${facts.length} recalled fact(s)`);
      })
      .catch(() => {
        // Memory is never load-bearing.
      });
    appendTurn({ role: "user", content: `Goal: ${g}`, timestamp: Date.now() });
    // Arm the pacing clocks: the plan overview just spoke, and "now" is the
    // baseline for screen stillness. Without these the stall check-in ladder
    // never fires before the first instruction — if the screen never changes
    // (e.g. capture is watching the wrong monitor) the app would stay silent
    // forever instead of asking what's going on.
    useSession.getState().setLastSpokeAt(Date.now());
    useSession.getState().setLastScreenChangeAt(Date.now());
    setStatus("watching");
    // Docking is persistent (driven by the dockEnabled setting + launch), so
    // there's nothing to toggle here — the sidebar is already in place.
  }

  /**
   * Training: start a session against a persisted curriculum (fresh from the
   * review screen or resumed from the library). The plan record — not the
   * session — is the unit of long-term progress here.
   */
  function startTrainingSession(plan: TrainingPlan) {
    if (!keyStatus.anthropic) { setView("settings"); return; }
    reset();
    setMode("training");
    const now = Date.now();
    const started = beginRun(plan, now);
    useSession.getState().setActivePlan(started);
    void api().plans.save(started);
    journaledRef.current = false;
    // Resuming into a module that was never detailed (the mid-session call
    // failed, or the app closed first): write it now, in the background — the
    // context block re-resolves when it lands.
    const module = currentModule(started);
    if (module && !module.detailed) {
      void detailModuleInBackground(started, started.cursor.module, (m) => api().log(m));
    }
    setGoal(plan.goal);
    const id = `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    useSession.getState().setSessionId(id);
    sessionStartedAtRef.current = now;
    void api()
      .memory.recall(plan.goal)
      .then(({ text, facts }) => {
        if (!text) return;
        if (useSession.getState().sessionId !== id) return;
        useSession.getState().setRecalledMemory(text);
        api().log(`[memory] applied ${facts.length} recalled fact(s)`);
      })
      .catch(() => {
        // Memory is never load-bearing.
      });
    appendTurn({ role: "user", content: `Goal: ${plan.goal}`, timestamp: now });
    useSession.getState().setLastSpokeAt(now);
    useSession.getState().setLastScreenChangeAt(now);
    setStatus("watching");
  }

  // Session-end bookkeeping runs exactly once per training session — stop and
  // quit can both reach it.
  const journaledRef = useRef(true);

  /**
   * Overwrite whereWeLeftOff and append the journal entry — the mechanical
   * memory a future session orients from. No API calls.
   */
  const finalizeTrainingPlan = useCallback(() => {
    if (journaledRef.current) return;
    const s = useSession.getState();
    const plan = s.activePlan;
    if (!plan) return;
    journaledRef.current = true;
    const now = Date.now();
    const task = currentTask(plan);
    const module = currentModule(plan);
    let next: TrainingPlan = {
      ...plan,
      whereWeLeftOff: buildWhereWeLeftOff(plan, s.completedSteps, now),
      updatedAt: now,
    };
    const note =
      `${new Date(now).toISOString().slice(0, 10)}: module ${plan.cursor.module + 1} ` +
      `"${module?.title ?? "?"}", task "${task?.title ?? "?"}" — ` +
      `${s.completedSteps.length} on-screen action(s) recorded.`;
    next = appendJournal(next, s.sessionId ?? "", note, now);
    void api().plans.save(next);
  }, []);

  function pause() {
    cancelTts();
    useSession.getState().setPauseReason("user");
    setStatus("paused");
  }
  function resume() {
    useSession.getState().setPauseReason(null);
    useSession.getState().setResearchQuery(null);
    useSession.getState().setLastClaudeCallAt(null);
    setStatus("watching");
  }
  /**
   * Persist the finished session to local history. Called on stop and on quit
   * so a session is recorded however the user leaves it — the common case is
   * closing the window, not pressing Stop.
   */
  const persistSession = useCallback(async (verdict: string | null) => {
    const s = useSession.getState();
    if (!s.sessionId || !s.goal || !s.mode) return;
    const record = buildSessionRecord({
      id: s.sessionId,
      mode: s.mode,
      goal: s.goal,
      startedAt: sessionStartedAtRef.current ?? Date.now(),
      endedAt: Date.now(),
      done: s.done,
      verdict,
      completedSteps: s.completedSteps,
      currentInstruction: s.currentInstruction,
      upcomingSteps: s.upcomingSteps,
      conversation: s.conversation,
      usage: s.usage,
      costUsd: s.costUsd,
      claudeCalls: s.claudeCalls,
    });
    if (!isWorthSaving(record)) return;
    try {
      await api().history.save(record);
    } catch {
      // History is never allowed to block ending a session.
    }
  }, []);

  // Autosave after every turn. History used to be written once, at the end, so
  // a renderer crash mid-session left no record of it at all — the session that
  // crashed on 7/29 lost 6 turns of transcript. Same session id, so this
  // overwrites in place instead of accumulating rows, and the save on stop/quit
  // still has the last word (it carries the verdict and the real outcome).
  const conversationLength = conversation.length;
  useEffect(() => {
    if (conversationLength === 0) return;
    if (!useSession.getState().sessionId) return;
    void persistSession(null);
  }, [conversationLength, persistSession]);

  function stop() {
    cancelTts();
    finalizeTrainingPlan();
    void persistSession(evalResult?.verdict ?? null);
    reset();
    setShowPeek(false);
    setShowStopConfirm(false);
    setEvalResult(null);
    setPlanOpen(false);
    // Stay docked — the sidebar is the persistent home, not a per-session
    // takeover. The user leaves docked mode via the header/Settings toggle.
  }

  async function markDone() {
    if (!goal || !mode) return;
    cancelTts();
    setEvalResult(null);
    setStatus("evaluating");
    // If the IPC call itself rejects (not just returns an error envelope),
    // the session must not stay parked in "evaluating" — nothing else moves
    // it, the loop doesn't tick there, and the Done button is hidden.
    let next: SessionStatus = "watching";
    try {
      const s = useSession.getState();
      const result = await api().claude.evaluateGoal({
        mode,
        goal,
        completedSteps: s.completedSteps,
        conversation: s.conversation,
        frames: s.frames.slice(-2),
      });
      if (!("__error" in result)) {
        setEvalResult(result);
        next = "waiting";
      }
    } catch (err) {
      api().log(`[eval] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (useSession.getState().status === "evaluating") setStatus(next);
    }
  }

  function submitFollowUp(text: string) {
    cancelTts();
    setEvalResult(null);
    appendTurn({ role: "user", content: text, timestamp: Date.now() });
    useSession.getState().setPendingFollowUp(text);
    useSession.getState().setLastClaudeCallAt(null);
    if (status === "thinking") return;
    if (
      status === "paused" ||
      status === "waiting" ||
      status === "error" ||
      status === "researching"
    ) {
      // A follow-up after "done" means the session is live again. `done` was
      // a one-way latch: nothing cleared it, so after one premature done the
      // training buttons stayed hidden and every later instruction rendered
      // inside the "Task complete" card for the rest of the session.
      if (status === "waiting") useSession.getState().setDone(false);
      useSession.getState().setPauseReason(null);
      useSession.getState().setResearchQuery(null);
      setStatus("watching");
    }
  }

  // Voice transcripts go through the same path as typed follow-ups.
  useEffect(() => {
    submitFollowUpRef.current = submitFollowUp;
  });

  async function attachContext() {
    const files = await api().files.pickContext();
    if (files.length > 0) useSession.getState().addUploadedContext(files);
  }

  function toggleVoice() {
    const next = !settings?.ttsEnabled;
    if (!next) cancelTts();
    void patchSettings({ ttsEnabled: next });
  }

  const showSpinner = status === "thinking" || status === "researching" || status === "clarifying";

  // Troubleshooting overrides the ambient status while the session is live —
  // the user should see the coach has switched from guiding to fixing.
  const fixing = troubleshooting && (status === "watching" || status === "thinking");
  const statusText = fixing ? "Troubleshooting…" : STATUS_TEXT[status];
  const statusDot  = fixing ? "#C07C10" : STATUS_DOT[status];

  // Collapsed — all hooks above keep running (capture loop, TTS), only the
  // UI shrinks. Docked: a thin vertical rail (the reserved strip narrows);
  // floating: the horizontal compact bar.
  if (collapsed) {
    if (docked) {
      return (
        <PanelShell docked animate={focused}>
          <DockRail
            status={status}
            statusText={statusText}
            dotColor={statusDot}
            instruction={instruction}
            ttsEnabled={settings?.ttsEnabled ?? false}
            isPaused={status === "paused"}
            onToggleVoice={toggleVoice}
            onPause={pause}
            onResume={resume}
            onExpand={() => void toggleCollapsed()}
          />
        </PanelShell>
      );
    }
    return (
      <PanelShell radius={16} animate={focused}>
        <CollapsedBar
          status={status}
          instruction={instruction}
          ttsEnabled={settings?.ttsEnabled ?? false}
          isPaused={status === "paused"}
          onToggleVoice={toggleVoice}
          onPause={pause}
          onResume={resume}
          onExpand={() => void toggleCollapsed()}
        />
      </PanelShell>
    );
  }

  if (view === "privacy") {
    return (
      <PanelShell docked={docked} animate={focused}>
        <PrivacyNotice
          onAccept={async () => {
            await patchSettings({ hasSeenPrivacyNotice: true });
            setView("panel");
          }}
        />
      </PanelShell>
    );
  }

  if (view === "settings") {
    return (
      <PanelShell docked={docked} animate={focused}>
        <SettingsView onClose={() => setView("panel")} />
      </PanelShell>
    );
  }

  return (
    <PanelShell docked={docked} animate={focused}>
      {docked && <DockResizeHandle side={settings?.dockSide ?? "left"} />}
      <PanelHeader
        status={status}
        statusText={statusText}
        dotColor={statusDot}
        mode={mode}
        showSpinner={showSpinner}
        docked={docked}
        ttsEnabled={settings?.ttsEnabled ?? false}
        onToggleVoice={toggleVoice}
        onToggleDock={() => void patchSettings({ dockEnabled: !docked })}
        onOpenSettings={openSettings}
        onAdjustCapture={() => { void api().overlay.setAdjust(true); }}
        onCollapse={() => void toggleCollapsed()}
        onMinimize={() => void api().window.minimize()}
        onQuit={() => {
          // Mid-session, closing loses progress — confirm. Otherwise just quit.
          if (goal) setShowQuitConfirm(true);
          else void api().app.quit();
        }}
      />

      {showQuitConfirm && (
        <QuitConfirmBanner
          onConfirm={() => {
            // Save before the process goes away — quitting mid-session is the
            // most common way a session actually ends.
            finalizeTrainingPlan();
            void persistSession(evalResult?.verdict ?? null).finally(() => {
              void api().app.quit();
            });
          }}
          onCancel={() => setShowQuitConfirm(false)}
        />
      )}

      {/* Peek overlay */}
      {showPeek && hasFrame && <PeekOverlay onClose={() => setShowPeek(false)} />}

      {/* Content area */}
      {(!mode || !goal) ? (
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 pt-2 sl-scroll">
          {!mode ? (
            <ModeSelect onSelect={setMode} onSettings={openSettings} />
          ) : (
            <GoalPrompt
              mode={mode}
              onStart={startSession}
              onStartPlan={startTrainingSession}
              onBack={() => { reset(); }}
            />
          )}
        </div>
      ) : (
        /* Session layout, top to bottom: progress rail, optional plan list,
           conversation, composer. Every region is in the normal flex flow —
           nothing floats over anything else, so opening the plan shrinks the
           conversation instead of burying it. */
        <div className="flex flex-1 flex-col" style={{ minHeight: 0 }}>
          <ProgressRail
            label={MODE_META[mode].goalLabel}
            goal={goal}
            steps={planSteps}
            open={planOpen}
            docked={docked}
            onToggle={() => setPlanOpen((v) => !v)}
          />

          {planOpen && (
            <>
              {activePlan ? (
                <div style={{ flexShrink: 0, padding: "8px 12px", borderBottom: `1px solid ${lt(0.08)}` }}>
                  <CurriculumOutline plan={activePlan} />
                </div>
              ) : (
                <PlanList steps={planSteps} />
              )}
              <div style={{ flexShrink: 0, padding: "8px 16px 10px", borderBottom: `1px solid ${lt(0.08)}` }}>
                <ContextPanel
                  fileNames={attachedFileNames}
                  notes={agentNotes}
                  onAttach={attachContext}
                />
              </div>
            </>
          )}

          {/* Conversation — the one region that grows and scrolls */}
          <div
            className="flex-1 overflow-y-auto sl-scroll"
            style={{ minHeight: 0, padding: "10px 12px 4px" }}
          >
            <ConversationHistory
              turns={conversation}
              hideLatestAssistant={instruction}
              autoScroll={false}
            />
            <div style={{ marginTop: 8 }}>
              <Instruction
                instruction={instruction}
                status={status}
                done={done}
                error={error}
                researchQuery={researchQuery}
                troubleshooting={troubleshooting}
                onStepDone={
                  mode === "tech_support"
                    ? () => submitFollowUp("Done — what's next?")
                    : undefined
                }
              />
            </div>
            {/* Training: the two explicit speech triggers. The coach watches
                silently; these buttons are how the user asks for its voice.
                Always available while a plan is active — hiding them on
                `done` left the user with no way to talk to the coach after
                one premature done. */}
            {mode === "training" && activePlan && (
              <div style={{ marginTop: 8 }}>
                <TrainingActions
                  busy={status === "thinking" || status === "evaluating"}
                  onCheckWork={() => submitFollowUp(CHECK_MY_WORK_FOLLOW_UP)}
                  onStuck={() => submitFollowUp(STUCK_FOLLOW_UP)}
                />
              </div>
            )}
            {evalResult && (
              <div style={{ marginTop: 8 }}>
                <EvalResultCard
                  achieved={evalResult.achieved}
                  verdict={evalResult.verdict}
                  onDismiss={() => setEvalResult(null)}
                />
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="px-3 pb-2 pt-1" style={{ flexShrink: 0 }}>
            <Composer
              isThinking={status === "thinking" || status === "evaluating"}
              mode={mode}
              onSubmit={submitFollowUp}
              onStartTalking={startTalking}
              onStopTalking={stopTalking}
            />
          </div>
        </div>
      )}

      {/* Control bar */}
      {goal && (
        <>
          {showStopConfirm && (
            <StopConfirmBanner
              onConfirm={stop}
              onCancel={() => setShowStopConfirm(false)}
            />
          )}
          <ControlBar
            status={status}
            ttsEnabled={settings?.ttsEnabled ?? false}
            hasPeek={hasFrame}
            showPeek={showPeek}
            attachedCount={attachedFileNames.length}
            rateLimitCountdown={rateLimitCountdown}
            onPause={pause}
            onResume={resume}
            onStop={() => setShowStopConfirm(true)}
            onToggleVoice={toggleVoice}
            onAttach={attachContext}
            onPeek={() => setShowPeek((v) => !v)}
            onMarkDone={() => void markDone()}
          />
        </>
      )}
    </PanelShell>
  );
}

/* ── Manual window dragging ──
   Grab anywhere that isn't an interactive control and the window follows the
   cursor (moved by the main process — CSS app-region drag is unreliable for
   transparent frameless windows on Windows). */

function beginWindowDrag(e: React.PointerEvent) {
  if (e.button !== 0) return;
  const el = e.target as HTMLElement;
  // Interactive/selectable elements keep their own pointer behavior. Scroll
  // containers are excluded too: WebKit swallows pointerup on scrollbar drags,
  // which previously left the window glued to the cursor.
  if (
    el.closest(
      "button, input, textarea, select, a, [role='button'], .no-drag, .sl-selectable, .sl-scroll",
    )
  )
    return;
  api().window.dragStart();
  // Pointer capture guarantees we receive pointerup even if the cursor ends
  // up over another element by the time the button is released.
  const shell = e.currentTarget as HTMLElement;
  try {
    shell.setPointerCapture(e.pointerId);
  } catch {
    // capture unsupported — global listeners below still cover it
  }
  const end = () => {
    api().window.dragEnd();
    try {
      shell.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/* ── Peek at the last captured frame ──
   The only place a frame is rendered, and the only subscriber to the frame
   buffer — so the per-tick frame push re-renders this (when open) and
   nothing else. */

function PeekOverlay({ onClose }: { onClose(): void }) {
  const lastFrame = useSession((s) => s.frames[s.frames.length - 1] ?? null);
  if (!lastFrame) return null;
  return (
    <div
      className="absolute inset-x-0 z-50 mx-2 cursor-pointer overflow-hidden rounded-xl border border-sl-divider bg-sl-bg shadow-xl"
      style={{ top: 72 }}
      onClick={onClose}
    >
      <img
        src={lastFrame.dataUrl}
        alt="Current view"
        className="max-h-48 w-full object-contain"
      />
      <p className="px-2 py-1 text-center font-mono text-[9px] text-sl-ink3">
        {new Date(lastFrame.timestamp).toLocaleTimeString()} · click to close
      </p>
    </div>
  );
}

/* ── Panel shell — full-window glass container ── */

function PanelShell({
  children,
  radius = 22,
  docked = false,
  animate = true,
}: {
  children: React.ReactNode;
  radius?: number;
  docked?: boolean;
  /** Run the ambient glow animation. Off while the window is unfocused — a
   *  blurred full-window layer repainting at 60 fps behind the app the user
   *  is actually working in is pure GPU cost. */
  animate?: boolean;
}) {
  const T = useTheme();
  const solidBg = useSettings((s) => s.settings?.solidBackground ?? false);
  // Docked: the window IS a reserved strip of the monitor — square corners,
  // solid surface, no glow bloom. Appbars are opaque rectangles.
  const r = docked ? 0 : radius;
  return (
    <div
      onPointerDown={beginWindowDrag}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        borderRadius: r,
        overflow: "hidden",
        fontFamily: T.font,
        color: T.ink,
      }}
    >
      {/* Background layer — glass or solid depending on setting. Light
          porcelain: the panel reads as a bright card, so it stands apart
          from whatever's on screen behind it. */}
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        ...(solidBg || docked ? {
          background: T.surface,
        } : {
          backdropFilter: "blur(26px) saturate(1.2)",
          WebkitBackdropFilter: "blur(26px) saturate(1.2)",
          background: `${T.glassGrad}, ${T.glassBg}`,
        }),
        border: `1px solid ${T.border}`,
        boxShadow: docked
          ? `0 1px 0 0 ${T.hi} inset`
          : `0 1px 0 0 ${T.hi} inset, 0 24px 60px -18px rgba(22,26,14,0.55), 0 0 0 1px rgba(22,26,14,0.18)`,
        borderRadius: r,
      }} />
      {!docked && <Glow paused={!animate} />}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        {children}
      </div>
    </div>
  );
}

/* ── Dock width resize handle ──
   The desktop-facing edge of the docked sidebar. Dragging re-asserts the
   AppBar rect live, so other windows re-flow while you drag (like resizing
   the taskbar). Width is clamped and persisted in the main process. */

function DockResizeHandle({ side }: { side: DockSide }) {
  const [active, setActive] = useState(false);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    setActive(true);
    let raf: number | null = null;
    let pending = 0;
    const move = (ev: PointerEvent) => {
      pending = side === "left" ? ev.clientX + 3 : window.innerWidth - ev.clientX + 3;
      if (raf == null) {
        raf = requestAnimationFrame(() => {
          raf = null;
          void api().dock.resize(pending);
        });
      }
    };
    const up = () => {
      setActive(false);
      if (raf != null) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div
      className="no-drag"
      title="Drag to resize the sidebar"
      onPointerDown={onPointerDown}
      style={{
        position: "absolute", top: 0, bottom: 0, width: 6, zIndex: 60,
        ...(side === "left" ? { right: 0 } : { left: 0 }),
        cursor: "ew-resize",
        background: active ? lt(0.14) : "transparent",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = lt(0.08); }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    />
  );
}

/* ── Training action row — Check my work · I'm stuck ── */

function TrainingActions({
  busy,
  onCheckWork,
  onStuck,
}: {
  busy: boolean;
  onCheckWork(): void;
  onStuck(): void;
}) {
  const T = useTheme();
  return (
    <div className="no-drag" style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        onClick={onCheckWork}
        disabled={busy}
        title="Done with this task? The coach looks at your work and gives feedback"
        style={{
          flex: 1,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          padding: "10px 12px", border: 0, borderRadius: 11,
          background: busy
            ? lt(0.08)
            : `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
          color: busy ? T.ink3 : T.onAccent,
          fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em",
          cursor: busy ? "default" : "pointer",
          boxShadow: busy ? "none" : `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M2 7l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "One sec…" : "Check my work"}
      </button>
      <button
        type="button"
        onClick={onStuck}
        disabled={busy}
        title="Stuck? Get a nudge — a hint, not the answer"
        style={{
          flex: 1,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          padding: "10px 12px", borderRadius: 11,
          border: `1px solid ${lt(0.14)}`,
          background: lt(0.04),
          color: busy ? T.ink3 : T.ink2,
          fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em",
          cursor: busy ? "default" : "pointer",
        }}
      >
        🖐 I'm stuck
      </button>
    </div>
  );
}

/* ── Evaluation result card ── */

function EvalResultCard({
  achieved,
  verdict,
  onDismiss,
}: {
  achieved: boolean;
  verdict: string;
  onDismiss(): void;
}) {
  const T = useTheme();
  return (
    <div style={{
      borderRadius: 11,
      padding: "10px 14px",
      background: achieved ? "rgba(143,203,102,0.08)" : "rgba(239,68,68,0.07)",
      border: `1px solid ${achieved ? "rgba(143,203,102,0.25)" : "rgba(239,68,68,0.25)"}`,
      display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
        {achieved ? "✓" : "✗"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: "0 0 3px", fontSize: 11, fontWeight: 700, color: achieved ? T.green : "#DB3B3B", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {achieved ? "Goal achieved" : "Not quite done"}
        </p>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: T.ink2 }}>{verdict}</p>
      </div>
      <button
        type="button"
        className="no-drag"
        onClick={onDismiss}
        title="Dismiss"
        style={{
          flexShrink: 0, width: 24, height: 24,
          display: "grid", placeItems: "center",
          border: 0, borderRadius: 7,
          background: "transparent", color: T.ink3,
          cursor: "pointer",
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/* ── Integrated panel header ── */

function PanelHeader({
  status,
  statusText,
  dotColor,
  mode,
  showSpinner,
  docked,
  ttsEnabled,
  onToggleVoice,
  onToggleDock,
  onOpenSettings,
  onAdjustCapture,
  onCollapse,
  onMinimize,
  onQuit,
}: {
  status: SessionStatus;
  statusText: string;
  dotColor: string;
  mode: AppMode | null;
  showSpinner: boolean;
  docked: boolean;
  ttsEnabled: boolean;
  onToggleVoice(): void;
  onToggleDock(): void;
  onOpenSettings(): void;
  onAdjustCapture(): void;
  onCollapse(): void;
  onMinimize(): void;
  onQuit(): void;
}) {
  const T = useTheme();
  const pulses   = status === "watching" || status === "thinking";
  // Docked, the whole panel is a ~400px strip. At the floating size these
  // controls overflow the header and pile on top of the status text.
  const btn = docked ? 30 : 36;
  const patchSettings = useSettings((s) => s.patch);
  const selectedDisplayId = useSettings((s) => s.settings?.selectedDisplayId ?? null);
  const selectedSourceId = useSettings((s) => s.settings?.selectedSourceId ?? null);
  const [targets, setTargets] = useState<CaptureTarget[]>([]);
  useEffect(() => {
    void api().capture.listTargets().then(setTargets);
  }, []);

  // The sight line: a luminous hairline under the header that encodes what
  // the assistant is doing — breathing while it watches, sweeping while it
  // thinks, quiet otherwise.
  const lineStyle: React.CSSProperties =
    status === "thinking" || status === "researching" || status === "evaluating"
      ? {
          background: `linear-gradient(90deg, transparent, ${T.accent} 35%, ${T.accentSoft} 50%, ${T.accent} 65%, transparent)`,
          backgroundSize: "60% 100%",
          backgroundRepeat: "no-repeat",
          animation: "sl-line-sweep 1.3s linear infinite",
        }
      : status === "watching"
        ? {
            background: `linear-gradient(90deg, transparent, ${T.accent} 30%, ${T.accent} 70%, transparent)`,
            animation: "sl-line-breathe 3.2s ease-in-out infinite",
          }
        : { background: lt(0.1) };

  return (
    <div
      className="drag-region"
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 12,
        padding: "13px 16px 11px",
        flexShrink: 0,
      }}
    >
      <span aria-hidden className="sl-sightline" style={{
        position: "absolute", left: 14, right: 14, bottom: 0, height: 2,
        borderRadius: 2, pointerEvents: "none", ...lineStyle,
      }} />
      <Logo size={docked ? 30 : 38} radius={docked ? 9 : 11} />

      {/* Docked, this is a ~400px strip and the wordmark, status, mode label
          and nine buttons cannot all fit — they used to overlap into an
          unreadable pile. Docked drops the wordmark (the logo is right there)
          and puts status on one clipped line. */}
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        {!docked && (
          <div style={{
            fontFamily: T.display, fontSize: 19, fontWeight: 650,
            letterSpacing: "-0.01em", lineHeight: 1.1, color: T.ink,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            SightLine
          </div>
        )}
        <div style={{
          marginTop: docked ? 0 : 3,
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, color: T.ink3,
          minWidth: 0, whiteSpace: "nowrap",
        }}>
          {/* Status dot */}
          <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7, flexShrink: 0 }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: dotColor }} />
            {pulses && (
              <span style={{
                position: "absolute", inset: -3, borderRadius: "50%",
                background: dotColor, opacity: 0.3,
                animation: "sl-live-pulse 1.5s ease-out infinite",
              }} />
            )}
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {statusText}
          </span>
          {mode && !docked && (
            <span style={{ color: T.ink3, flexShrink: 0 }}>
              ·&nbsp;<span style={{ color: T.accentText, fontWeight: 600 }}>{MODE_LABELS[mode]}</span>
            </span>
          )}
        </div>
      </div>

      {showSpinner && <Spinner size={24} />}

      <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
        <CtrlBtn
          size={btn}
          title={ttsEnabled ? "Voice on — click to mute the coach" : "Muted — click to turn the coach's voice on"}
          onClick={onToggleVoice}
          color={ttsEnabled ? undefined : "#C22F2F"}
        >
          {ttsEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
        </CtrlBtn>
        {/* Capture area lives in Settings too; docked there is no room for it. */}
        {!docked && (
          <CtrlBtn size={btn} title="Adjust capture area" onClick={onAdjustCapture}>
            <CropIcon />
          </CtrlBtn>
        )}
        <CtrlBtn
          size={btn}
          title={docked ? "Undock — float the window" : "Dock to the side of the screen"}
          onClick={onToggleDock}
        >
          <DockIcon active={docked} />
        </CtrlBtn>
        {targets.length > 1 && (
          <CtrlBtn
            size={btn}
            title={`Watching: ${
              targets.find(
                (t) =>
                  t.sourceId === selectedSourceId ||
                  (!selectedSourceId && t.displayId === selectedDisplayId),
              )?.label ?? "Primary"
            } — click to switch screens (previews in Settings)`}
            onClick={() => {
              const idx = targets.findIndex(
                (t) =>
                  t.sourceId === selectedSourceId ||
                  (!selectedSourceId && t.displayId === selectedDisplayId),
              );
              const next = targets[(idx + 1) % targets.length];
              void patchSettings({
                selectedDisplayId: next.displayId,
                selectedSourceId: next.sourceId,
                selectedSourceName: next.sourceName,
              });
            }}
          >
            <IMonitor />
          </CtrlBtn>
        )}
        <CtrlBtn size={btn} title="Settings" onClick={onOpenSettings}>
          <IGear />
        </CtrlBtn>

        {/* Standard window controls: minimize · collapse · close */}
        <span aria-hidden style={{ width: 1, height: 20, background: lt(0.12), margin: docked ? "0 3px" : "0 6px", flexShrink: 0 }} />
        <WindowBtn size={btn} title="Minimize" onClick={onMinimize}>
          <IMinimize />
        </WindowBtn>
        <WindowBtn size={btn} title="Collapse to compact bar" onClick={onCollapse}>
          <ChevronDownIcon />
        </WindowBtn>
        <WindowBtn size={btn} title="Close SightLine" onClick={onQuit} danger>
          <IClose />
        </WindowBtn>
      </div>
    </div>
  );
}

// Window-chrome button — quieter than CtrlBtn but always findable, with a
// bordered hit target like every other app's title bar.
function WindowBtn({
  children,
  title,
  onClick,
  danger,
  size = 32,
}: {
  children: React.ReactNode;
  title: string;
  onClick(): void;
  danger?: boolean;
  size?: number;
}) {
  const T = useTheme();
  return (
    <button
      type="button"
      className="no-drag"
      title={title}
      onClick={onClick}
      style={{
        width: size, height: size, flexShrink: 0,
        display: "grid", placeItems: "center",
        borderRadius: 9, cursor: "pointer",
        background: danger ? "rgba(219,59,59,0.1)" : lt(0.05),
        border: `1px solid ${danger ? "rgba(219,59,59,0.35)" : lt(0.1)}`,
        color: danger ? "#C22F2F" : T.ink2,
        marginLeft: 2,
      }}
    >
      {children}
    </button>
  );
}

/* ── Control bar — flat icon row replacing the D-pad ── */

function ControlBar({
  status,
  ttsEnabled,
  hasPeek,
  showPeek,
  attachedCount,
  rateLimitCountdown,
  onPause,
  onResume,
  onStop,
  onToggleVoice,
  onAttach,
  onPeek,
  onMarkDone,
}: {
  status: SessionStatus;
  ttsEnabled: boolean;
  hasPeek: boolean;
  showPeek: boolean;
  attachedCount: number;
  rateLimitCountdown: number | null;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onToggleVoice(): void;
  onAttach(): void;
  onPeek(): void;
  onMarkDone(): void;
}) {
  const T   = useTheme();
  const isPaused = status === "paused";

  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "center", gap: 2,
        padding: "10px 12px 12px",
        borderTop: `1px solid ${lt(0.07)}`,
        flexShrink: 0,
      }}
    >
      {/* The coach's voice. Deliberately NOT a microphone icon: a mic means
          input, this controls output, and the hold-to-talk mic sits directly
          above it in the composer. Muted state is a labelled red pill rather
          than a tinted icon — an app that has silently stopped talking must
          say so, not hint at it. */}
      {ttsEnabled ? (
        <CtrlBtn
          title="Voice on — click to mute the coach"
          onClick={onToggleVoice}
          color={T.accentText}
        >
          <SpeakerOnIcon />
        </CtrlBtn>
      ) : (
        <button
          type="button"
          className="no-drag"
          onClick={onToggleVoice}
          title="The coach is muted — click to turn its voice back on"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            height: 30, padding: "0 9px", borderRadius: 9,
            border: "1px solid rgba(219,59,59,0.45)",
            background: "rgba(219,59,59,0.12)",
            color: "#C22F2F", cursor: "pointer",
            fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em",
            fontFamily: "inherit", flexShrink: 0,
          }}
        >
          <SpeakerOffIcon />
          MUTED
        </button>
      )}

      <CtrlBtn
        title={attachedCount > 0 ? `${attachedCount} file(s) attached — attach more` : "Attach file"}
        onClick={onAttach}
        color={attachedCount > 0 ? T.ink : undefined}
      >
        <AttachIcon />
      </CtrlBtn>

      {hasPeek && (
        <CtrlBtn
          title="Peek at last screenshot"
          onClick={onPeek}
          color={showPeek ? T.accentText : undefined}
        >
          <IExpand c={showPeek ? T.accentText : "currentColor"} />
        </CtrlBtn>
      )}

      {/* Pause / Resume — accent gradient, primary action */}
      <button
        className="no-drag"
        onClick={isPaused ? onResume : onPause}
        title={isPaused ? "Resume" : "Pause"}
        style={{
          width: 36, height: 36, border: 0, borderRadius: 11, cursor: "pointer",
          background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
          color: T.onAccent,
          display: "grid", placeItems: "center",
          boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
          flexShrink: 0,
          transition: "opacity 150ms",
          marginLeft: 4,
        }}
      >
        {isPaused ? <PlayIcon c={T.onAccent} /> : <IPause c={T.onAccent} />}
      </button>

      <div style={{ flex: 1 }} />

      {/* Rate limit countdown */}
      {rateLimitCountdown != null && rateLimitCountdown > 0 && (
        <span style={{ fontSize: 10, color: T.ink3, fontVariantNumeric: "tabular-nums", marginRight: 4 }}>
          {rateLimitCountdown}s
        </span>
      )}

      {/* Live pill doubling as the spend meter — the cost of watching someone's
          screen should be visible while it's happening, not after the fact. */}
      <CostPill />

      {/* "I'm done — check my work" */}
      {(status === "watching" || status === "waiting") && (
        <button
          className="no-drag"
          onClick={onMarkDone}
          title="I'm done — let the AI check my work"
          style={{
            height: 30, border: `1px solid ${lt(0.12)}`,
            borderRadius: 9, cursor: "pointer",
            background: "transparent", color: T.ink2,
            fontSize: 10.5, fontWeight: 600, padding: "0 10px",
            letterSpacing: "0.02em", flexShrink: 0,
          }}
        >
          Done ✓
        </button>
      )}

      {/* Stop */}
      <CtrlBtn title="Stop session" onClick={onStop} color="#ef4444">
        <StopIcon />
      </CtrlBtn>
    </div>
  );
}

/* ── Spend meter ──
   Doubles as the "live" indicator. Turns amber as the session approaches its
   budget and red once it stops, so the cap is never a silent surprise. */

function CostPill() {
  const T = useTheme();
  const costUsd = useSession((s) => s.costUsd);
  const calls = useSession((s) => s.claudeCalls);
  const limit = useSettings((s) => s.settings?.sessionBudgetUsd ?? 0);
  const budget = budgetStatus(costUsd, limit);

  const tone =
    budget.level === "exceeded"
      ? { fg: "#C22F2F", bg: "rgba(219,59,59,0.12)", bd: "rgba(219,59,59,0.4)" }
      : budget.level === "warn"
        ? { fg: "#B4770C", bg: "rgba(192,124,16,0.12)", bd: "rgba(192,124,16,0.4)" }
        : {
            fg: T.accentText,
            bg: ar(T.accentRGB, 0.14),
            bd: ar(T.accentRGB, 0.4),
          };

  const title =
    limit > 0
      ? `This session: ${formatUsd(costUsd)} of a ${formatUsd(limit)} cap, over ${calls} look${calls === 1 ? "" : "s"} at your screen`
      : `This session: ${formatUsd(costUsd)} over ${calls} look${calls === 1 ? "" : "s"} at your screen (no cap set)`;

  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: tone.fg,
        padding: "5px 10px",
        borderRadius: 999,
        background: tone.bg,
        border: `1px solid ${tone.bd}`,
        flexShrink: 0,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone.fg,
          boxShadow: `0 0 8px ${tone.fg}`,
          animation:
            budget.level === "exceeded"
              ? "none"
              : "sl-blink 1.6s ease-in-out infinite",
        }}
      />
      {formatUsd(costUsd)}
    </span>
  );
}

/* ── Stop confirmation banner ── */

function StopConfirmBanner({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const T = useTheme();
  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px",
        borderTop: `1px solid ${lt(0.07)}`,
        background: "rgba(239,68,68,0.07)",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, color: T.ink2, flex: 1 }}>
        End session? Your progress will be cleared.
      </span>
      <button
        type="button"
        onClick={onCancel}
        style={{
          borderRadius: 8, border: `1px solid ${lt(0.12)}`,
          background: "transparent", color: T.ink2,
          fontSize: 11, padding: "5px 12px", cursor: "pointer",
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        style={{
          borderRadius: 8, border: 0,
          background: "#ef4444", color: "#fff",
          fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer",
        }}
      >
        End session
      </button>
    </div>
  );
}

/* ── Quit confirmation banner ── */

function QuitConfirmBanner({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const T = useTheme();
  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px",
        borderBottom: `1px solid ${lt(0.07)}`,
        background: "rgba(239,68,68,0.07)",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, color: T.ink2, flex: 1 }}>
        Quit SightLine?
      </span>
      <button
        type="button"
        onClick={onCancel}
        style={{
          borderRadius: 8, border: `1px solid ${lt(0.12)}`,
          background: "transparent", color: T.ink2,
          fontSize: 11, padding: "5px 12px", cursor: "pointer",
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        style={{
          borderRadius: 8, border: 0,
          background: "#ef4444", color: "#fff",
          fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer",
        }}
      >
        Quit
      </button>
    </div>
  );
}

/* ── Collapsed compact bar ── */

function CollapsedBar({
  status,
  instruction,
  ttsEnabled,
  isPaused,
  onToggleVoice,
  onPause,
  onResume,
  onExpand,
}: {
  status: SessionStatus;
  instruction: string;
  ttsEnabled: boolean;
  isPaused: boolean;
  onToggleVoice(): void;
  onPause(): void;
  onResume(): void;
  onExpand(): void;
}) {
  const T = useTheme();
  const dotColor = STATUS_DOT[status];
  const pulses   = status === "watching" || status === "thinking";

  return (
    <div
      className="drag-region"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        height: "100%", padding: "0 10px 0 14px",
      }}
    >
      {/* Status dot */}
      <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8, flexShrink: 0 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: dotColor }} />
        {pulses && (
          <span style={{
            position: "absolute", inset: -3, borderRadius: "50%",
            background: dotColor, opacity: 0.3,
            animation: "sl-live-pulse 1.5s ease-out infinite",
          }} />
        )}
      </span>

      {/* Current instruction, one line */}
      <span style={{
        flex: 1, minWidth: 0, fontSize: 12, color: T.ink2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {instruction || STATUS_TEXT[status]}
      </span>

      <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <CtrlBtn
          title={ttsEnabled ? "Voice on — click to mute the coach" : "Muted — click to turn the coach's voice on"}
          onClick={onToggleVoice}
          color={ttsEnabled ? T.accentText : "#C22F2F"}
        >
          {ttsEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
        </CtrlBtn>
        <button
          className="no-drag"
          onClick={isPaused ? onResume : onPause}
          title={isPaused ? "Resume" : "Pause"}
          style={{
            width: 30, height: 30, border: 0, borderRadius: 9, cursor: "pointer",
            background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
            color: T.onAccent,
            display: "grid", placeItems: "center",
            flexShrink: 0,
          }}
        >
          {isPaused ? <PlayIcon c={T.onAccent} /> : <IPause c={T.onAccent} />}
        </button>
        <CtrlBtn title="Expand" onClick={onExpand}>
          <ChevronUpIcon />
        </CtrlBtn>
      </div>
    </div>
  );
}

/* ── Context panel (files + agent notes) ── */

function ContextPanel({
  fileNames,
  notes,
  onAttach,
}: {
  fileNames: string[];
  notes: string[];
  onAttach(): void;
}) {
  const T = useTheme();
  const [notesOpen, setNotesOpen] = useState(false);
  const hasContent = fileNames.length > 0 || notes.length > 0;

  if (!hasContent) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink3 }}>
          Context
        </span>
        <button
          type="button"
          onClick={onAttach}
          className="no-drag"
          title="Attach text or markdown files"
          style={{
            borderRadius: 8, border: `1px solid ${lt(0.08)}`,
            background: lt(0.04), padding: "3px 10px",
            fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
            cursor: "pointer", transition: "background 150ms",
          }}
        >
          + Attach file
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink3 }}>
          Context
        </span>
        <button
          type="button"
          onClick={onAttach}
          className="no-drag"
          style={{
            borderRadius: 8, border: `1px solid ${lt(0.08)}`,
            background: lt(0.04), padding: "3px 10px",
            fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
            cursor: "pointer",
          }}
        >
          + Attach
        </button>
      </div>
      {fileNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {fileNames.map((name, i) => (
            <span
              key={i}
              title={name}
              style={{
                borderRadius: 6, border: `1px solid ${lt(0.08)}`,
                background: lt(0.04), padding: "2px 8px",
                fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
              }}
            >
              {name}
            </span>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            style={{
              fontFamily: "ui-monospace, monospace", fontSize: 9,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: T.ink3, background: "transparent", border: 0, cursor: "pointer",
              transition: "color 150ms",
            }}
          >
            {notesOpen ? "▼" : "▶"} Notes ({notes.length})
          </button>
          {notesOpen && (
            <ul className="sl-selectable sl-scroll" style={{
              marginTop: 6, display: "flex", flexDirection: "column", gap: 4,
              maxHeight: 128, overflowY: "auto", paddingRight: 2,
            }}>
              {notes.map((note, i) => (
                <li
                  key={i}
                  style={{
                    borderRadius: 8, background: ar("194,232,75", 0.06),
                    padding: "6px 10px", fontSize: 11, lineHeight: 1.4, color: T.ink2,
                  }}
                >
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Local SVG icons (not in the design icon set) ── */

function SpeakerOnIcon() {
  const T = useTheme();
  return <ISpeakerOn c={T.accent} />;
}

function SpeakerOffIcon() {
  const T = useTheme();
  return <ISpeakerOff c={T.ink3} />;
}

function CropIcon() {
  const T = useTheme();
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 1.5v9h9" stroke={T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 3h9v9" stroke={T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2.5 1.5" />
    </svg>
  );
}

// A screen with a filled left rail — the docked-sidebar glyph. Filled when
// docked, outline-only when floating.
function DockIcon({ active }: { active: boolean }) {
  const T = useTheme();
  const c = active ? T.accent : T.ink2;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke={c} strokeWidth="1.4" />
      <rect x="1.5" y="2.5" width="4" height="9" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.35} />
    </svg>
  );
}

function CloseIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13 7.5l-5.5 5.5a4 4 0 0 1-5.66-5.66l5.5-5.5a2.5 2.5 0 0 1 3.54 3.54L5.37 10.9a1 1 0 0 1-1.41-1.41L9.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon({ c }: { c?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3.5l8 4.5-8 4.5V3.5Z" fill={c || "currentColor"} />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}
