import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./store/session";
import { useSettings } from "./store/settings";
import { useSessionLoop } from "./hooks/useSessionLoop";
import { useRateLimitCountdown } from "./hooks/useRateLimitCountdown";
import { useTts } from "./hooks/useTts";
import { api } from "./lib/api";
import { markAsk, sinceAsk } from "./lib/askClock";
import {
  STEP_DONE_REPLY,
} from "./lib/quickReplies";
import { Composer } from "./components/Composer";
import { Home } from "./components/Home";
import { AboutChat } from "./components/AboutChat";
import { liveNotes } from "../electron/chat-notes";
import type {
  CaptureTarget,
  DockSide,
  SessionStatus,
  TokenUsage,
} from "./lib/api";
import { ModelCaption } from "./components/ModelCaption";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { Settings as SettingsView } from "./components/Settings";
import { PhaseRail } from "./components/PhaseRail";
import { PhaseChat } from "./components/phase/PhaseChat";
import { PhaseFooter } from "./components/phase/PhaseFooter";
import { PhaseHeader } from "./components/phase/PhaseHeader";
import { ReadyPill } from "./components/phase/ReadyPill";
import { ChatMenu } from "./components/phase/ChatMenu";
import { NeedsYouBanner } from "./components/phase/NeedsYouBanner";
import { useFollowCurrent } from "./hooks/useFollowCurrent";
import {
  NEEDS_YOU_ACTION_LABEL,
  coachState,
  needsYouOf,
  resumeDividerText,
} from "./lib/phaseView";
import { useTokens } from "./design/ThemeProvider";
import { usePhaseView } from "./hooks/usePhaseView";
import {
  buildChatRecord,
  buildWhereWeLeftOff,
  chatToSession,
  isWorthSaving,
  titleFromGoal,
} from "../electron/chat-record";
import { usePushToTalk } from "./hooks/usePushToTalk";
import { useTheme } from "./design/ThemeProvider";
import { Glow, Logo, Spinner, CtrlBtn } from "./design/primitives";
import {
  IPause,
  IGear,
  IMonitor,
  IMinimize,
  IClose,
  ISpeakerOn,
  ISpeakerOff,
} from "./design/icons";
import { lt, type SightLineTheme } from "./design/theme";
import { EMPTY_USAGE, addUsage, budgetStatus } from "../electron/usage";

type View = "panel" | "settings" | "privacy";

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle:        "Ready when you are",
  watching:    "Watching your screen",
  thinking:    "Thinking…",
  waiting:     "Done",
  paused:      "Paused",
  error:       "Error",
};

// Status dot colours, from the palette: accent while it works, warn when
// something is wrong, secondary ink at rest.
function statusDotColor(T: SightLineTheme, status: SessionStatus | "fixing"): string {
  if (status === "thinking" || status === "fixing" || status === "error") return T.warn;
  if (status === "watching" || status === "waiting") return T.accent;
  return T.ink2;
}

export default function App() {
  const status         = useSession((s) => s.status);
  const goal           = useSession((s) => s.goal);
  const agreedGoal     = useSession((s) => s.agreedGoal);
  const doneWhen       = useSession((s) => s.doneWhen);
  const goalPending    = useSession((s) => s.goalPending);
  const instruction   = useSession((s) => s.currentInstruction);
  const currentCode    = useSession((s) => s.currentCode);
  const activeTool     = useSession((s) => s.activeTool);
  // Only WHETHER a frame exists is subscribed here. pushFrame creates a new
  // array on every tick, so subscribing to `frames` re-rendered the entire
  // tree every 15 s and on every input burst; the one component that shows
  // a frame (PeekOverlay) reads it itself.
  const hasFrame       = useSession((s) => s.frames.length > 0);
  const error          = useSession((s) => s.lastError);
  const done           = useSession((s) => s.done);
  const reset          = useSession((s) => s.reset);
  const setStatus      = useSession((s) => s.setStatus);
  const setGoal        = useSession((s) => s.setGoal);
  const appendTurn     = useSession((s) => s.appendTurn);
  const conversation   = useSession((s) => s.conversation);
  const attachedFileNames = useSession((s) => s.attachedFileNames);
  const agentNotes     = useSession((s) => s.agentNotes);
  const troubleshooting = useSession((s) => s.troubleshooting);
  const stance         = useSession((s) => s.stance);
  const stepLog        = useSession((s) => s.stepLog);
  const stages         = useSession((s) => s.stages);
  const stageIndex     = useSession((s) => s.stageIndex);
  const tidy           = useSession((s) => s.tidy);

  const settings      = useSettings((s) => s.settings);
  const keyStatus     = useSettings((s) => s.keyStatus);
  const loadSettings  = useSettings((s) => s.load);
  const patchSettings = useSettings((s) => s.patch);

  const [view, setView]                   = useState<View>("panel");
  const [focused, setFocused]             = useState(false);
  const [showPeek, setShowPeek]           = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [collapsed, setCollapsed]         = useState(false);
  const [docked, setDocked]               = useState(false);
  const [aboutOpen, setAboutOpen]         = useState(false);
  const [menuOpen, setMenuOpen]           = useState(false);
  // The resume divider (SPEC §6.5). resumePending is consumed by the first
  // look, so the time away is captured here when the chat is opened.
  const [resumeMark, setResumeMark] = useState<{ chat: string; step: number; at: number; text: string } | null>(null);
  // What the open chat had already run up before this sitting, and when it
  // began. The store counts one sitting — that is what the spending cap
  // applies to — while the saved chat carries the running total.
  const chatBaseRef = useRef<{
    createdAt: number;
    title: string;
    usage: TokenUsage;
    costUsd: number;
    claudeCalls: number;
  } | null>(null);

  // No scroll-to-newest here any more: the phase chat moves the view only by
  // the rules in useFollowCurrent (redesign SPEC §6.2, §6.7).

  const rateLimitCountdown = useRateLimitCountdown();
  // The phase-chat view model, tracked for the sitting (plan changes, the
  // current step's title, the layout floor). Called on every render so the
  // tracking is continuous while the panel is collapsed too.
  const { view: phaseView, notes: planNotes, planArrivedAt } = usePhaseView();
  const sessionId = useSession((s) => s.sessionId);
  const listening = useSession((s) => s.listening);
  const pointing  = useSession((s) => s.pointing);
  const follow = useFollowCurrent(phaseView, sessionId);
  const tokens = useTokens();
  const legacyTheme = useTheme();
  // The chat column comes back (expanding the panel, closing About this
  // chat): land on the current phase, as a reopened chat does.
  const landOnCurrent = follow.landOnCurrent;
  useEffect(() => {
    if (collapsed || aboutOpen || !useSession.getState().goal) return;
    const id = requestAnimationFrame(() => landOnCurrent());
    return () => cancelAnimationFrame(id);
  }, [collapsed, aboutOpen, landOnCurrent]);
  const { cancel: cancelTts } = useTts();

  const openSettings = useCallback(() => setView("settings"), []);
  useSessionLoop(openSettings);

  // Voice in. Declared before submitFollowUp exists, so the transcript is
  // routed through a ref-stable callback rather than capturing it.
  const submitFollowUpRef = useRef<(text: string) => void>(() => {});
  const { startTalking, stopTalking } = usePushToTalk((text) =>
    submitFollowUpRef.current(text),
  );

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

  // Recall what we know about this user before the first look at the screen.
  // Fire-and-forget: memory is an enhancement, and waiting on disk I/O here
  // would delay the first instruction for no good reason. Worst case the
  // first tick goes out without it and every tick after has it.
  function recallMemoryFor(goalText: string, chatId: string) {
    void api()
      .memory.recall(goalText)
      .then(({ text, facts }) => {
        if (!text) return;
        if (useSession.getState().sessionId !== chatId) return; // chat changed
        useSession.getState().setRecalledMemory(text);
        api().log(`[memory] applied ${facts.length} recalled fact(s)`);
      })
      .catch(() => {
        // Memory is never load-bearing.
      });
  }

  /**
   * Reopen a saved chat: the conversation, the step log, the plan and the
   * coach's notes all come back, and the coach starts watching again.
   */
  async function openChat(id: string) {
    if (!keyStatus.anthropic) { setView("settings"); return; }
    const record = await api().chats.get(id);
    if (!record) {
      api().log(`[chats] could not open ${id}: no saved record`);
      return;
    }
    reset();
    useSession.getState().loadChat(chatToSession(record));
    useSession.getState().setSessionId(record.id);
    const now = Date.now();
    chatBaseRef.current = {
      createdAt: record.createdAt,
      title: record.title,
      usage: record.usage,
      costUsd: record.costUsd,
      claudeCalls: record.claudeCalls,
    };
    api().log(
      `[chats] opened ${record.id} (${record.turns.length} turns, ${record.stepLog.length} steps logged, ` +
        `last active ${Math.round((now - record.lastActiveAt) / 60_000)} min ago)`,
    );
    recallMemoryFor(record.goal, record.id);
    // The first look greets them with where things stood. A finished chat
    // opens at rest instead, so there is no look to greet on.
    if (record.state !== "done") {
      setResumeMark({
        chat: record.id,
        step: record.stepLog.length + 1,
        at: now,
        text: resumeDividerText((now - record.lastActiveAt) / 60_000),
      });
      useSession.getState().setResumePending({
        awayMinutes: (now - record.lastActiveAt) / 60_000,
        whereWeLeftOff: record.whereWeLeftOff,
      });
    }
    useSession.getState().setLastSpokeAt(now);
    useSession.getState().setLastScreenChangeAt(now);
    // A finished chat opens at rest; saying anything to it wakes it up.
    setStatus(record.state === "done" ? "waiting" : "watching");
  }

  function startSession(g: string) {
    if (!keyStatus.anthropic) { setView("settings"); return; }
    reset();
    // One front door: every goal goes to the same coach, which decides for
    // itself how to help.
    setGoal(g);
    // Every goal is a chat. Mint its id up front so the first autosave, and
    // anything the coach learns along the way, can be attributed to it even
    // if the chat is never cleanly left.
    const id = `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    useSession.getState().setSessionId(id);
    chatBaseRef.current = {
      createdAt: Date.now(),
      title: titleFromGoal(g),
      usage: { ...EMPTY_USAGE },
      costUsd: 0,
      claudeCalls: 0,
    };
    // Everything between submitting the goal and this line is time the user
    // waited before the coach could start.
    const setup = sinceAsk(Date.now());
    if (setup?.kind === "goal") {
      api().log(`[timing] session started ${setup.ms}ms after goal`);
    }

    recallMemoryFor(g, id);
    appendTurn({ role: "user", content: `Goal: ${g}`, timestamp: Date.now() });
    // Arm the pacing clocks: "now" is the baseline for screen stillness and
    // for the last time anything was said. Without these the stall check-in ladder
    // never fires before the first instruction — if the screen never changes
    // (e.g. capture is watching the wrong monitor) the app would stay silent
    // forever instead of asking what's going on.
    useSession.getState().setLastSpokeAt(Date.now());
    useSession.getState().setLastScreenChangeAt(Date.now());
    setStatus("watching");
    // Docking is persistent (driven by the dockEnabled setting + launch), so
    // there's nothing to toggle here — the sidebar is already in place.
  }

  function pause() {
    cancelTts();
    setStatus("paused");
  }
  function resume() {
    useSession.getState().setLastClaudeCallAt(null);
    setStatus("watching");
  }
  /**
   * Save the open chat. The record is built synchronously from the store, so
   * a caller can reset the session straight after without losing anything.
   */
  const persistChat = useCallback(async () => {
    const s = useSession.getState();
    const base = chatBaseRef.current;
    if (!s.sessionId || !s.goal || !base) return;
    const record = buildChatRecord({
      id: s.sessionId,
      title: base.title,
      goal: s.goal,
      agreedGoal: s.agreedGoal,
      doneWhen: s.doneWhen,
      goalPending: s.goalPending,
      createdAt: base.createdAt,
      now: Date.now(),
      done: s.done,
      stance: s.stance,
      stepLog: s.stepLog,
      currentStep: s.currentInstruction,
      currentCode: s.currentCode,
      expectedResult: s.lastExpectedResult,
      upcomingSteps: s.upcomingSteps,
      stages: s.stages,
      stageIndex: s.stageIndex,
      tidy: s.tidy,
      notes: s.agentNotes,
      conversation: s.conversation,
      uploadedContext: s.uploadedContext,
      attachedFileNames: s.attachedFileNames,
      usage: addUsage(base.usage, s.usage),
      costUsd: base.costUsd + s.costUsd,
      claudeCalls: base.claudeCalls + s.claudeCalls,
    });
    if (!isWorthSaving(record)) return;
    try {
      await api().chats.save(record);
    } catch {
      // Saving is never allowed to block leaving a chat.
    }
  }, []);

  // Autosave as the chat moves. Saved once at the end, a renderer crash
  // mid-chat would lose the whole thing — and closing the window, not a tidy
  // exit, is how most chats are actually left. A silent look can log a step
  // or a note without adding to the conversation, so those count too.
  const conversationLength = conversation.length;
  const stepLogLength = stepLog.length;
  // Keyed on the notes array itself, not its length: the user editing or
  // forgetting a note changes no length, and must still be saved.
  useEffect(() => {
    if (conversationLength === 0) return;
    if (!useSession.getState().sessionId) return;
    void persistChat();
  }, [conversationLength, stepLogLength, agentNotes, stance, stages, stageIndex, done, goalPending, persistChat]);

  /** Back to the chat list. Nothing is lost: the chat is saved as it stands. */
  function leaveChat() {
    cancelTts();
    void persistChat();
    reset();
    chatBaseRef.current = null;
    setShowPeek(false);
    setAboutOpen(false);
    setMenuOpen(false);
    // Stay docked — the sidebar is the persistent home, not a per-chat
    // takeover. The user leaves docked mode via the header/Settings toggle.
  }

  /** About this chat → Mark done. The same resting state the coach's own "done" leaves. */
  function markChatDone() {
    cancelTts();
    useSession.getState().setDone(true);
    setStatus("waiting");
  }

  /**
   * About this chat → Delete, after the panel's own confirmation. The session
   * is cleared first, so no autosave can write the chat back after it goes.
   */
  async function deleteOpenChat() {
    const id = useSession.getState().sessionId;
    cancelTts();
    reset();
    chatBaseRef.current = null;
    setShowPeek(false);
    setAboutOpen(false);
    if (!id) return;
    try {
      await api().chats.delete(id);
      api().log(`[chats] deleted ${id} from About this chat`);
    } catch {
      // Nothing to recover: the chat is closed either way.
    }
  }

  function submitFollowUp(text: string) {
    cancelTts();
    markAsk("followup", Date.now());
    appendTurn({ role: "user", content: text, timestamp: Date.now() });
    useSession.getState().setPendingFollowUp(text);
    useSession.getState().setLastClaudeCallAt(null);
    if (status === "thinking") return;
    if (status === "paused" || status === "waiting" || status === "error") {
      // A follow-up after "done" means the session is live again. `done` was
      // a one-way latch: nothing cleared it, so after one premature done every
      // later instruction rendered inside the "Task complete" card for the
      // rest of the session.
      if (status === "waiting") useSession.getState().setDone(false);
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

  const showSpinner = status === "thinking";

  // Troubleshooting overrides the ambient status while the session is live —
  // the user should see the coach has switched from guiding to fixing.
  const fixing = troubleshooting && (status === "watching" || status === "thinking");
  // A mid-turn tool is the one moment "Thinking…" is actively misleading —
  // the user is waiting on a web search and deserves to know.
  const toolText =
    status === "thinking" && activeTool
      ? activeTool.name === "search_web"
        ? "Looking that up…"
        : activeTool.name === "search_memory"
          ? "Checking earlier chats…"
          : "Taking a closer look…"
      : null;
  // The coach has said the goal back and is not looking again until the user
  // answers — "Watching your screen" would be untrue.
  const awaitingGoal = goalPending && status === "watching";
  const statusText =
    toolText ??
    (awaitingGoal
      ? "Waiting for your go-ahead"
      : fixing
        ? "Troubleshooting…"
        : STATUS_TEXT[status]);
  const statusDot  = statusDotColor(legacyTheme, fixing ? "fixing" : status);

  // Collapsed — all hooks above keep running (capture loop, TTS), only the
  // UI shrinks. Docked: a thin vertical rail (the reserved strip narrows);
  // floating: the horizontal compact bar.
  if (collapsed) {
    if (docked) {
      return (
        <PanelShell docked animate={focused}>
          {/* The phase rail on its own (redesign SPEC §3.6). The collapse
              wiring — window resize and the AppBar strip — is unchanged. */}
          <PhaseRail
            view={phaseView}
            collapsed
            muted={!(settings?.ttsEnabled ?? false)}
            paused={status === "paused"}
            needsYou={status === "error" || Boolean(error) || rateLimitCountdown !== null}
            haloOff={goalPending && status !== "thinking"}
            latestLine={instruction}
            onAllChats={() => {
              // Home does not fit in 64 px: expand, then leave the chat.
              void toggleCollapsed().then(leaveChat);
            }}
            // A circle expands the panel and scrolls to its phase or step.
            onPhase={(i) => {
              void toggleCollapsed().then(() =>
                requestAnimationFrame(() => requestAnimationFrame(() => follow.scrollToPhase(i))),
              );
            }}
            onStep={(n) => {
              void toggleCollapsed().then(() =>
                requestAnimationFrame(() => requestAnimationFrame(() => follow.scrollToStep(n))),
              );
            }}
            onMute={toggleVoice}
            onPause={status === "paused" ? resume : pause}
            onCollapse={() => void toggleCollapsed()}
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

  // ── The open chat: the phase-chat screen (redesign SPEC §2, §5) ──
  function openChatView() {
    const t = tokens.palette;
    const quick = phaseView.layout === "quick";
    const capUsd = settings?.sessionBudgetUsd ?? 0;
    const need = needsYouOf({
      status,
      error,
      hasKey: keyStatus.anthropic,
      capReached: budgetStatus(useSession.getState().costUsd, capUsd).level === "exceeded",
      rateLimitSeconds: rateLimitCountdown,
    });
    const needsYou = need !== null;
    const newest = conversation[conversation.length - 1];
    const coach = coachState({
      status,
      activeTool: activeTool?.name ?? null,
      newest,
      goalPending,
      done,
      listening,
      troubleshooting,
      needsYou,
      stepDoneReply: STEP_DONE_REPLY,
    });
    const stateWord = coach.word;
    const statusRow = coach.statusRow;
    const needAction = need?.action
      ? {
          label: NEEDS_YOU_ACTION_LABEL[need.action],
          onClick:
            need.action === "retry"
              ? () => {
                  useSession.getState().setError(null);
                  resume();
                }
              : openSettings,
        }
      : null;
    // The divider appears once the coach's greeting has arrived (SPEC §6.5).
    const resumeDivider =
      resumeMark &&
      resumeMark.chat === sessionId &&
      conversation.some((t) => t.role === "assistant" && t.timestamp >= resumeMark.at)
        ? resumeMark
        : null;
    // The agreed goal once there is one; otherwise the chat's title (which the
    // tidy-up may have improved), and the user's own words only as a last resort.
    const title = (!goalPending && agreedGoal) || chatBaseRef.current?.title || goal || "";
    const placeholder =
      done || quick
        ? conversation.length <= 1 && !instruction
          ? "Ask or tell it anything"
          : "Ask a follow-up"
        : goalPending
          ? // No step is in progress while the goal waits on a yes.
            "Ask or tell it anything"
          : `Ask about step ${phaseView.currentStep}`;
    const railEntering = planArrivedAt !== null && Date.now() - planArrivedAt < 1000;
    const onQuit = () => {
      if (goal) setShowQuitConfirm(true);
      else void api().app.quit();
    };

    return (
      <PanelShell docked={docked} animate={focused}>
        {docked && <DockResizeHandle side={settings?.dockSide ?? "left"} />}
        <div style={{ flex: 1, minHeight: 0, display: "flex", background: t.bg, color: t.ink }}>
          <div className={railEntering ? "sl-rail-enter" : undefined} style={{ display: "flex", flexShrink: 0 }}>
            <PhaseRail
              view={phaseView}
              collapsed={false}
              muted={!(settings?.ttsEnabled ?? false)}
              paused={status === "paused"}
              needsYou={needsYou}
              haloOff={coach.halo !== "breathing"}
              onAllChats={leaveChat}
              onPhase={(i) => follow.scrollToPhase(i)}
              onStep={(n) => follow.scrollToStep(n)}
              onMute={toggleVoice}
              onPause={status === "paused" ? resume : pause}
              onCollapse={() => void toggleCollapsed()}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
            <PhaseHeader
              title={title}
              view={phaseView}
              stateWord={stateWord}
              menuOpen={menuOpen}
              onMenu={() => setMenuOpen((v) => !v)}
              quickControls={{
                muted: !(settings?.ttsEnabled ?? false),
                paused: status === "paused",
                onAllChats: leaveChat,
                onMute: toggleVoice,
                onPause: status === "paused" ? resume : pause,
                onCollapse: () => void toggleCollapsed(),
              }}
            />
            {menuOpen && (
              <ChatMenu
                docked={docked}
                aboutOpen={aboutOpen}
                attachedCount={attachedFileNames.length}
                canPeek={hasFrame}
                onClose={() => setMenuOpen(false)}
                onAbout={() => setAboutOpen((v) => !v)}
                onAttach={() => void attachContext()}
                onPeek={() => setShowPeek(true)}
                onAdjustArea={() => { void api().overlay.setAdjust(true); }}
                onToggleDock={() => void patchSettings({ dockEnabled: !docked })}
                onSettings={openSettings}
                onMinimize={() => void api().window.minimize()}
                onQuit={onQuit}
              />
            )}
            {showQuitConfirm && (
              <QuitConfirmBanner
                onConfirm={() => {
                  // Save before the process goes away — quitting mid-chat is
                  // the most common way a sitting actually ends.
                  void persistChat().finally(() => {
                    void api().app.quit();
                  });
                }}
                onCancel={() => setShowQuitConfirm(false)}
              />
            )}
            {showPeek && hasFrame && <PeekOverlay onClose={() => setShowPeek(false)} />}

            {aboutOpen ? (
              <div className="flex-1 overflow-y-auto sl-scroll" style={{ minHeight: 0 }}>
                <AboutChat
                  goal={agreedGoal || goal || ""}
                  doneWhen={doneWhen}
                  whereWeLeftOff={
                    // The tidy-up's summary, until the chat moves on from it.
                    tidy && tidy.whereWeLeftOff && tidy.turns === conversation.length
                      ? tidy.whereWeLeftOff
                      : buildWhereWeLeftOff({
                          stepLog,
                          currentStep: instruction,
                          done,
                          stages,
                          stageIndex,
                        })
                  }
                  tidyNote={tidy?.changed ?? ""}
                  notes={liveNotes(agentNotes)}
                  fileNames={attachedFileNames}
                  done={done}
                  onEditNote={(id, text) => useSession.getState().editAgentNote(id, text)}
                  onForgetNote={(id) => useSession.getState().forgetAgentNote(id, Date.now())}
                  onMarkDone={markChatDone}
                  onDelete={() => void deleteOpenChat()}
                  onClose={() => setAboutOpen(false)}
                />
              </div>
            ) : (
              <PhaseChat
                view={phaseView}
                stateWord={stateWord}
                currentInstruction={instruction}
                currentCode={currentCode}
                notes={planNotes}
                pendingGoal={goalPending && !done ? { goal: agreedGoal || goal || "", doneWhen } : null}
                scrollRef={follow.scrollRef}
                onScroll={follow.onScroll}
                onUserScroll={follow.onUserScroll}
                resume={resumeDivider}
                banner={need ? <NeedsYouBanner message={need.message} detail={need.detail} action={needAction} /> : undefined}
                footer={
                  quick ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {pointing && !done && (
                        <div style={{ fontSize: 12.5, color: t.ink2 }}>
                          Outlined on your screen. I&apos;ll move on when I see it&apos;s done.
                        </div>
                      )}
                      {statusRow ? (
                        <PhaseFooter stance={stance} pointing={false} statusRow={statusRow} onReply={submitFollowUp} />
                      ) : status === "paused" ? (
                        <PhaseFooter stance={stance} pointing={false} paused onReply={submitFollowUp} onResume={resume} />
                      ) : goalPending ? (
                        <PhaseFooter stance={stance} pointing={false} goalPending onReply={submitFollowUp} />
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: t.ink2 }}>
                          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent }} />
                          {done ? "Done." : "Watching quietly."}
                        </div>
                      )}
                    </div>
                  ) : done ? // A finished goal has nothing left to tick off: the completion
                  // section stands alone (SPEC §6.6, §7 "Done").
                  undefined : (
                    <PhaseFooter
                      stance={stance}
                      pointing={pointing}
                      statusRow={statusRow}
                      goalPending={goalPending}
                      paused={status === "paused"}
                      onReply={submitFollowUp}
                      onResume={resume}
                    />
                  )
                }
              />
            )}
            {follow.pill && !aboutOpen && <ReadyPill label={follow.pill} onClick={follow.onPillClick} />}
            <div style={{ flexShrink: 0 }}>
              <Composer
                placeholder={placeholder}
                isThinking={status === "thinking"}
                onSubmit={submitFollowUp}
                onStartTalking={startTalking}
                onStopTalking={stopTalking}
              />
              <ModelCaption style={{ display: "block", padding: "0 16px 8px", marginTop: -6 }} />
            </div>
          </div>
        </div>
      </PanelShell>
    );
  }

  if (goal) return openChatView();

  return (
    <PanelShell docked={docked} animate={focused}>
      {docked && <DockResizeHandle side={settings?.dockSide ?? "left"} />}
      <PanelHeader
        status={status}
        statusText={statusText}
        dotColor={statusDot}
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
            void persistChat().finally(() => {
              void api().app.quit();
            });
          }}
          onCancel={() => setShowQuitConfirm(false)}
        />
      )}

      {/* Peek overlay */}
      {showPeek && hasFrame && <PeekOverlay onClose={() => setShowPeek(false)} />}

      {/* Home: unchanged until its layout is designed (WP9 recolours it). */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 pt-2 sl-scroll">
        <Home
          onStart={(g) => startSession(g)}
          onOpen={(id) => void openChat(id)}
        />
      </div>
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
  const { palette: t } = useTokens();
  if (!lastFrame) return null;
  return (
    <div
      className="absolute inset-x-0 z-50 mx-2 cursor-pointer overflow-hidden rounded-xl shadow-xl"
      style={{ top: 72, border: `1px solid ${t.line}`, background: t.card }}
      onClick={onClose}
    >
      <img
        src={lastFrame.dataUrl}
        alt="Current view"
        className="max-h-48 w-full object-contain"
      />
      <p className="px-2 py-1 text-center" style={{ fontSize: 11.5, color: t.ink2 }}>
        {new Date(lastFrame.timestamp).toLocaleTimeString()} · click to close
      </p>
    </div>
  );
}

/* ── Panel shell — full-window glass container ── */

function PanelShell({
  children,
  // Floating panel corner radius (redesign SPEC §1: radius.floatingPanel).
  radius = 14,
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

function PanelHeader({
  status,
  statusText,
  dotColor,
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
    status === "thinking"
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
        </div>
      </div>

      {showSpinner && <Spinner size={24} />}

      <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
        <CtrlBtn
          size={btn}
          title={ttsEnabled ? "Voice on — click to mute the coach" : "Muted — click to turn the coach's voice on"}
          onClick={onToggleVoice}
          color={ttsEnabled ? undefined : T.warn}
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
        background: danger ? T.warnSoft : lt(0.05),
        border: `1px solid ${danger ? T.warn : lt(0.1)}`,
        color: danger ? T.warn : T.ink2,
        marginLeft: 2,
      }}
    >
      {children}
    </button>
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
        background: T.warnSoft,
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
          background: T.warn, color: T.onWarn,
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
  const dotColor = statusDotColor(T, status);
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
          color={ttsEnabled ? T.accentText : T.warn}
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

/* ── Local SVG icons (not in the design icon set) ── */

// A circled "i" — About this chat.
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

function PlayIcon({ c }: { c?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3.5l8 4.5-8 4.5V3.5Z" fill={c || "currentColor"} />
    </svg>
  );
}

