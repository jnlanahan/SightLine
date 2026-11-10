// Chats are what the user comes back to, and the step log is their record of
// what was actually done. Both have to survive a restart exactly, and the log
// must never be rewritten after the fact.

import { beforeEach, describe, expect, it } from "vitest";
import {
  appendToStepLog,
  buildChatRecord,
  buildWhereWeLeftOff,
  chatToSession,
  isWorthSaving,
  summarizeChat,
  titleFromGoal,
  type ChatSnapshot,
} from "../../electron/chat-record";
import { EMPTY_USAGE } from "../../electron/usage";
import { useSession } from "../store/session";

function snapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    id: "chat_1",
    title: "Set up a VPN",
    goal: "Set up a VPN on this laptop",
    createdAt: 1_000,
    now: 9_000,
    done: false,
    stance: "guide",
    stepLog: [
      { text: "Downloaded the client", at: 2_000 },
      { text: "Installed it", at: 5_000 },
    ],
    currentStep: "Go ahead and open the app. You'll see a sign-in screen.",
    currentCode: "",
    expectedResult: "the sign-in screen is showing",
    upcomingSteps: ["Sign in", "Connect to a server"],
    notes: ["They're on Windows 11"],
    conversation: [
      { role: "user", content: "Goal: Set up a VPN on this laptop", timestamp: 1_000 },
      { role: "assistant", content: "Run this in a terminal.", code: "winget install vpn", timestamp: 1_500 },
    ],
    uploadedContext: "",
    attachedFileNames: [],
    usage: { ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20 },
    costUsd: 0.12,
    claudeCalls: 4,
    ...overrides,
  };
}

describe("the step log", () => {
  it("stamps each newly finished step with the time", () => {
    const log = appendToStepLog([], ["Opened Settings"], 1_000);
    expect(log).toEqual([{ text: "Opened Settings", at: 1_000 }]);
    expect(appendToStepLog(log, ["Opened Settings", "Clicked Network"], 4_000)).toEqual([
      { text: "Opened Settings", at: 1_000 },
      { text: "Clicked Network", at: 4_000 },
    ]);
  });

  it("never rewrites an entry, whatever the coach's list says later", () => {
    const log = [
      { text: "Opened Settings", at: 1_000 },
      { text: "Clicked Network", at: 4_000 },
    ];
    // The coach reworded step one and added a third.
    const next = appendToStepLog(
      log,
      ["Opened the Settings app", "Clicked Network", "Turned on the VPN"],
      9_000,
    );
    expect(next.slice(0, 2)).toEqual(log);
    expect(next[2]).toEqual({ text: "Turned on the VPN", at: 9_000 });
  });

  it("never shrinks", () => {
    const log = [
      { text: "Opened Settings", at: 1_000 },
      { text: "Clicked Network", at: 4_000 },
    ];
    expect(appendToStepLog(log, ["Opened Settings"], 9_000)).toBe(log);
    expect(appendToStepLog(log, [], 9_000)).toBe(log);
  });

  it("ignores blank entries", () => {
    expect(appendToStepLog([], ["  ", "Opened Settings"], 1_000)).toEqual([
      { text: "Opened Settings", at: 1_000 },
    ]);
  });
});

describe("the live session's step log", () => {
  beforeEach(() => useSession.getState().reset());

  it("grows with the coach's reports and keeps the coach's view in step", () => {
    useSession.getState().applyCompletedSteps(["Opened Settings"], 1_000);
    useSession.getState().applyCompletedSteps(["Opened Settings", "Clicked Network"], 4_000);
    const s = useSession.getState();
    expect(s.stepLog.map((e) => e.at)).toEqual([1_000, 4_000]);
    expect(s.completedSteps).toEqual(["Opened Settings", "Clicked Network"]);
  });

  it("shows the coach the log's own wording, not its reworded version", () => {
    useSession.getState().applyCompletedSteps(["Opened Settings"], 1_000);
    useSession
      .getState()
      .applyCompletedSteps(["Opened the Settings app", "Clicked Network"], 4_000);
    expect(useSession.getState().completedSteps).toEqual([
      "Opened Settings",
      "Clicked Network",
    ]);
  });

  it("is cleared with the session", () => {
    useSession.getState().applyCompletedSteps(["Opened Settings"], 1_000);
    useSession.getState().reset();
    expect(useSession.getState().stepLog).toEqual([]);
  });
});

describe("chat titles", () => {
  it("uses a short goal as it is", () => {
    expect(titleFromGoal("  Freeze the top row ")).toBe("Freeze the top row");
  });

  it("cuts a long goal on a word boundary", () => {
    const title = titleFromGoal(
      "Teach me how to build pivot tables in Excel so I can summarise my monthly sales figures",
    );
    expect(title.length).toBeLessThanOrEqual(49);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });
});

describe("where we left off", () => {
  it("names the last few steps and what comes next", () => {
    const line = buildWhereWeLeftOff({
      stepLog: [
        { text: "Downloaded the client", at: 1 },
        { text: "Installed it", at: 2 },
      ],
      currentStep: "Open the app and sign in.",
      done: false,
    });
    expect(line).toBe(
      "Done so far: Downloaded the client; Installed it. Next: Open the app and sign in.",
    );
  });

  it("says so when nothing is finished yet", () => {
    expect(
      buildWhereWeLeftOff({ stepLog: [], currentStep: "Open Excel.", done: false }),
    ).toBe("Nothing finished yet. Next: Open Excel.");
  });

  it("reads as finished for a finished chat", () => {
    expect(
      buildWhereWeLeftOff({
        stepLog: [{ text: "Connected to a server", at: 1 }],
        currentStep: "You're all set.",
        done: true,
      }),
    ).toBe("Finished. Last steps: Connected to a server.");
  });
});

describe("saving a chat", () => {
  it("keeps code blocks, which the old session record dropped", () => {
    const record = buildChatRecord(snapshot());
    expect(record.turns[1]).toEqual({
      role: "assistant",
      content: "Run this in a terminal.",
      code: "winget install vpn",
      at: 1_500,
    });
  });

  it("keeps the step log with its times, and a where-we-left-off line", () => {
    const record = buildChatRecord(snapshot());
    expect(record.stepLog).toEqual([
      { text: "Downloaded the client", at: 2_000 },
      { text: "Installed it", at: 5_000 },
    ]);
    expect(record.whereWeLeftOff).toContain("Installed it");
    expect(record.lastActiveAt).toBe(9_000);
    expect(record.state).toBe("active");
  });

  it("marks a finished chat done", () => {
    expect(buildChatRecord(snapshot({ done: true })).state).toBe("done");
  });

  it("is not worth a row until the coach has said something", () => {
    const untouched = buildChatRecord(
      snapshot({
        conversation: [{ role: "user", content: "Goal: Set up a VPN", timestamp: 1 }],
      }),
    );
    expect(isWorthSaving(untouched)).toBe(false);
    expect(isWorthSaving(buildChatRecord(snapshot()))).toBe(true);
  });

  it("summarises for the list without the transcript", () => {
    const summary = summarizeChat(buildChatRecord(snapshot()));
    expect(summary).toMatchObject({
      id: "chat_1",
      title: "Set up a VPN",
      state: "active",
      stepsDone: 2,
    });
    expect(summary).not.toHaveProperty("turns");
    expect(summary).not.toHaveProperty("stepLog");
  });
});

describe("reopening a chat", () => {
  it("restores everything the coach and the user need to carry on", () => {
    const restored = chatToSession(buildChatRecord(snapshot({ stance: "watch" })));
    expect(restored.goal).toBe("Set up a VPN on this laptop");
    expect(restored.stance).toBe("watch");
    expect(restored.stepLog).toHaveLength(2);
    expect(restored.completedSteps).toEqual(["Downloaded the client", "Installed it"]);
    expect(restored.upcomingSteps).toEqual(["Sign in", "Connect to a server"]);
    expect(restored.currentInstruction).toContain("open the app");
    expect(restored.lastExpectedResult).toBe("the sign-in screen is showing");
    expect(restored.agentNotes).toEqual(["They're on Windows 11"]);
    expect(restored.conversation[1]).toMatchObject({
      role: "assistant",
      code: "winget install vpn",
      timestamp: 1_500,
    });
    expect(restored.done).toBe(false);
  });

  it("remembers the last thing said, so it is not repeated word for word", () => {
    const restored = chatToSession(buildChatRecord(snapshot()));
    expect(restored.lastSpokenInstruction).toBe("Run this in a terminal.");
  });

  it("survives being written to disk and read back", () => {
    const record = buildChatRecord(snapshot());
    const roundTripped = JSON.parse(JSON.stringify(record));
    expect(chatToSession(roundTripped)).toEqual(chatToSession(record));
  });

  it("loads into the live session", () => {
    useSession.getState().reset();
    useSession.getState().loadChat(chatToSession(buildChatRecord(snapshot())));
    const s = useSession.getState();
    expect(s.goal).toBe("Set up a VPN on this laptop");
    expect(s.stepLog).toHaveLength(2);
    expect(s.conversation).toHaveLength(2);
    useSession.getState().reset();
  });
});
