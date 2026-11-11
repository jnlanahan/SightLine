// Chats are what the user comes back to, and the step log is their record of
// what was actually done. Both have to survive a restart exactly, and the log
// must never be rewritten after the fact.

import { beforeEach, describe, expect, it } from "vitest";
import {
  appendToStepLog,
  buildChatRecord,
  buildWhereWeLeftOff,
  chatToSession,
  clampStage,
  isChatId,
  isChatRecordShape,
  isWorthSaving,
  normalizeChatRecord,
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
    stages: [],
    stageIndex: 0,
    notes: [
      { id: "note_a", text: "They're on Windows 11", seen: true, at: 3_000, retiredAt: null },
      { id: "note_b", text: "Their old VPN client was removed", seen: false, at: 4_000, retiredAt: 6_000 },
    ],
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

describe("chat ids", () => {
  // An id becomes a file name in the main process, and it arrives over IPC.
  it("accepts the shape the app mints", () => {
    const minted = `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    expect(isChatId(minted)).toBe(true);
    expect(isChatId("chat_1")).toBe(true);
  });

  it("refuses anything that could leave the chats folder", () => {
    for (const bad of [
      "../../settings",
      "..\\..\\keys",
      "chat_../x",
      "chat_a/b",
      "chat_a\\b",
      "chat_a.json",
      "C:\\Users\\x",
      "chat_",
      "",
      "sess_abc123",
      "CHAT_ABC",
      `chat_${"a".repeat(41)}`,
    ]) {
      expect(isChatId(bad), bad).toBe(false);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const bad of [undefined, null, 42, {}, ["chat_1"]]) {
      expect(isChatId(bad)).toBe(false);
    }
  });
});

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
    // Note ids, flags, times and retired notes all come back: a retired note
    // is what keeps a forgotten one from being written straight back.
    expect(restored.agentNotes).toEqual([
      { id: "note_a", text: "They're on Windows 11", seen: true, at: 3_000, retiredAt: null },
      { id: "note_b", text: "Their old VPN client was removed", seen: false, at: 4_000, retiredAt: 6_000 },
    ]);
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

describe("chats saved before notes had ids", () => {
  // The exact shape step 3 wrote: notes as plain strings.
  function oldShape() {
    const record = buildChatRecord(snapshot()) as unknown as Record<string, unknown>;
    return { ...record, notes: ["They're on Windows 11", "  ", "Uses the work account"] };
  }

  it("convert on read, marked not seen, with stable ids", () => {
    const read = normalizeChatRecord(oldShape() as never);
    expect(read.notes).toEqual([
      { id: "note_old0", text: "They're on Windows 11", seen: false, at: 1_000, retiredAt: null },
      { id: "note_old2", text: "Uses the work account", seen: false, at: 1_000, retiredAt: null },
    ]);
    // The same old file always converts the same way, so an edit made by id
    // in one sitting still finds its note.
    expect(normalizeChatRecord(oldShape() as never).notes).toEqual(read.notes);
  });

  it("reopen into the live session with notes the screen can edit", () => {
    const restored = chatToSession(oldShape() as never);
    expect(restored.agentNotes.map((n) => n.text)).toEqual([
      "They're on Windows 11",
      "Uses the work account",
    ]);
    expect(restored.agentNotes.every((n) => n.seen === false && n.retiredAt === null)).toBe(true);
    // Everything else about the chat is untouched.
    expect(restored.stepLog).toHaveLength(2);
  });

  it("save back in the new shape", () => {
    const restored = chatToSession(oldShape() as never);
    const saved = buildChatRecord(snapshot({ notes: restored.agentNotes }));
    expect(saved.notes[0]).toMatchObject({ id: "note_old0", seen: false });
  });

  it("survive a notes field that is missing or junk", () => {
    const record = buildChatRecord(snapshot()) as unknown as Record<string, unknown>;
    expect(normalizeChatRecord({ ...record, notes: undefined } as never).notes).toEqual([]);
    expect(normalizeChatRecord({ ...record, notes: [42, null, {}] } as never).notes).toEqual([]);
  });
});

describe("the user's note edits and the next autosave", () => {
  beforeEach(() => useSession.getState().reset());

  it("a forgotten note is saved as retired, and the coach cannot write it back", () => {
    useSession.getState().loadChat(chatToSession(buildChatRecord(snapshot())));
    useSession.getState().forgetAgentNote("note_a", 7_000);
    // The coach notices the same thing again on its next look.
    useSession.getState().appendAgentNote("They're on Windows 11", true, 8_000);
    const s = useSession.getState();
    const saved = buildChatRecord(snapshot({ notes: s.agentNotes }));
    const note = saved.notes.find((n) => n.id === "note_a")!;
    expect(note.retiredAt).toBe(7_000);
    expect(saved.notes.filter((n) => n.retiredAt === null)).toHaveLength(0);
  });

  it("an edited note is what the next save writes", () => {
    useSession.getState().loadChat(chatToSession(buildChatRecord(snapshot())));
    useSession.getState().editAgentNote("note_a", "They're on Windows 10, not 11");
    // A later note from the coach must not bring the old wording back.
    useSession.getState().appendAgentNote("They use the work VPN", false, 8_000);
    const saved = buildChatRecord(snapshot({ notes: useSession.getState().agentNotes }));
    expect(saved.notes.find((n) => n.id === "note_a")!.text).toBe(
      "They're on Windows 10, not 11",
    );
    expect(saved.notes.find((n) => n.id === "note_a")!.seen).toBe(true);
  });
});

describe("a long plan's stages", () => {
  const stages = ["Shape the data", "Build the table", "Group by month"];

  beforeEach(() => useSession.getState().reset());

  it("are saved with the chat and restored with it", () => {
    const record = buildChatRecord(snapshot({ stages, stageIndex: 1 }));
    expect(record.stages).toEqual(stages);
    expect(record.stageIndex).toBe(1);
    const restored = chatToSession(JSON.parse(JSON.stringify(record)));
    expect(restored.stages).toEqual(stages);
    expect(restored.stageIndex).toBe(1);
  });

  it("lead the where-we-left-off line", () => {
    const record = buildChatRecord(snapshot({ stages, stageIndex: 1 }));
    expect(record.whereWeLeftOff.startsWith("Stage 2 of 3: Build the table. ")).toBe(true);
    expect(buildChatRecord(snapshot()).whereWeLeftOff.startsWith("Done so far")).toBe(true);
  });

  it("default to none for a chat saved before stages existed", () => {
    const old = JSON.parse(JSON.stringify(buildChatRecord(snapshot())));
    delete old.stages;
    delete old.stageIndex;
    const restored = chatToSession(old);
    expect(restored.stages).toEqual([]);
    expect(restored.stageIndex).toBe(0);
  });

  it("never point outside the list", () => {
    expect(clampStage(7, 3)).toBe(2);
    expect(clampStage(-1, 3)).toBe(0);
    expect(clampStage(undefined, 3)).toBe(0);
    expect(clampStage(2, 0)).toBe(0);
  });

  it("are laid out and advanced by the coach, counting from 1", () => {
    useSession.getState().applyStages(stages, 1);
    expect(useSession.getState().stageIndex).toBe(0);
    useSession.getState().applyStages(null, 2);
    expect(useSession.getState().stages).toEqual(stages);
    expect(useSession.getState().stageIndex).toBe(1);
    useSession.getState().applyStages(null, 9);
    expect(useSession.getState().stageIndex).toBe(2);
  });

  it("tag each logged step with the stage it was done in", () => {
    useSession.getState().applyStages(stages, 1);
    useSession.getState().applyCompletedSteps(["Removed blank rows"], 1_000);
    useSession.getState().applyStages(null, 2);
    useSession
      .getState()
      .applyCompletedSteps(["Removed blank rows", "Inserted the pivot table"], 2_000);
    expect(useSession.getState().stepLog).toEqual([
      { text: "Removed blank rows", at: 1_000, stage: "Shape the data" },
      { text: "Inserted the pivot table", at: 2_000, stage: "Build the table" },
    ]);
  });

  it("leave the log untagged in a chat without stages", () => {
    useSession.getState().applyCompletedSteps(["Opened Settings"], 1_000);
    expect(useSession.getState().stepLog).toEqual([{ text: "Opened Settings", at: 1_000 }]);
  });
});

describe("the agreed goal", () => {
  const agreed = {
    agreedGoal: "Get the VPN connected on this laptop",
    doneWhen: "the client shows Connected",
  };

  beforeEach(() => useSession.getState().reset());

  it("is saved with the chat and restored with it, waiting or agreed", () => {
    const waiting = buildChatRecord(snapshot({ ...agreed, goalPending: true }));
    const restored = chatToSession(JSON.parse(JSON.stringify(waiting)));
    expect(restored.agreedGoal).toBe(agreed.agreedGoal);
    expect(restored.doneWhen).toBe(agreed.doneWhen);
    expect(restored.goalPending).toBe(true);
    // The user's own words are kept beside it.
    expect(restored.goal).toBe("Set up a VPN on this laptop");

    const settled = chatToSession(buildChatRecord(snapshot({ ...agreed, goalPending: false })));
    expect(settled.goalPending).toBe(false);
  });

  it("defaults to none, and nothing waiting, for a chat saved before goals were agreed", () => {
    const old = JSON.parse(JSON.stringify(buildChatRecord(snapshot())));
    delete old.agreedGoal;
    delete old.doneWhen;
    delete old.goalPending;
    const restored = chatToSession(old);
    expect(restored.agreedGoal).toBe("");
    expect(restored.doneWhen).toBe("");
    expect(restored.goalPending).toBe(false);
  });

  it("waits on a yes when the coach proposes it, and stands once the coach moves on", () => {
    useSession.getState().proposeGoal(agreed.agreedGoal, agreed.doneWhen);
    expect(useSession.getState().goalPending).toBe(true);
    expect(useSession.getState().agreedGoal).toBe(agreed.agreedGoal);
    useSession.getState().agreeGoal();
    expect(useSession.getState().goalPending).toBe(false);
    expect(useSession.getState().agreedGoal).toBe(agreed.agreedGoal);
  });

  it("keeps the wording already there when the coach asks again without one", () => {
    useSession.getState().proposeGoal(agreed.agreedGoal, agreed.doneWhen);
    useSession.getState().agreeGoal();
    useSession.getState().proposeGoal("", "");
    expect(useSession.getState().goalPending).toBe(true);
    expect(useSession.getState().agreedGoal).toBe(agreed.agreedGoal);
    expect(useSession.getState().doneWhen).toBe(agreed.doneWhen);
  });

  it("is cleared with the session", () => {
    useSession.getState().proposeGoal(agreed.agreedGoal, agreed.doneWhen);
    useSession.getState().reset();
    expect(useSession.getState().agreedGoal).toBe("");
    expect(useSession.getState().goalPending).toBe(false);
  });
});

describe("refusing a chat that is not a chat", () => {
  it("accepts a real record, before and after a trip to disk", () => {
    const record = buildChatRecord(snapshot());
    expect(isChatRecordShape(record)).toBe(true);
    expect(isChatRecordShape(JSON.parse(JSON.stringify(record)))).toBe(true);
  });

  it("refuses a record missing the parts the app indexes into", () => {
    const record = JSON.parse(JSON.stringify(buildChatRecord(snapshot())));
    for (const key of ["stepLog", "turns", "upcomingSteps", "title", "goal"]) {
      const damaged = { ...record };
      delete damaged[key];
      expect(isChatRecordShape(damaged), key).toBe(false);
    }
    expect(isChatRecordShape({ ...record, id: "../../x" })).toBe(false);
    expect(isChatRecordShape({ ...record, state: "paused" })).toBe(false);
    expect(isChatRecordShape(null)).toBe(false);
    expect(isChatRecordShape("chat_1")).toBe(false);
  });
});

describe("turn step tags (redesign WP2)", () => {
  const tagged = () =>
    snapshot({
      conversation: [
        { role: "user", content: "Goal: Set up a VPN on this laptop", timestamp: 1_000, stage: 0, step: 1 },
        { role: "assistant", content: "Run this.", code: "winget install vpn", timestamp: 1_500, stage: 1, step: 3 },
      ],
    });

  it("are saved with each turn", () => {
    const record = buildChatRecord(tagged());
    expect(record.turns[0]).toMatchObject({ stage: 0, step: 1 });
    expect(record.turns[1]).toMatchObject({ stage: 1, step: 3, code: "winget install vpn" });
    expect(isChatRecordShape(record)).toBe(true);
  });

  it("survive disk and come back into the live session", () => {
    const record = JSON.parse(JSON.stringify(buildChatRecord(tagged())));
    const restored = chatToSession(record);
    expect(restored.conversation.map((t) => [t.stage, t.step])).toEqual([
      [0, 1],
      [1, 3],
    ]);
  });

  it("old turns without tags still load, with no tags invented", () => {
    const record = buildChatRecord(snapshot());
    expect(record.turns.every((t) => !("stage" in t) && !("step" in t))).toBe(true);
    expect(isChatRecordShape(record)).toBe(true);
    const restored = chatToSession(record);
    expect(restored.conversation).toHaveLength(2);
    expect(restored.conversation.every((t) => t.step === undefined && t.stage === undefined)).toBe(true);
  });

  it("a record whose tags are not numbers is refused", () => {
    const record = buildChatRecord(snapshot()) as unknown as { turns: Record<string, unknown>[] };
    record.turns[0].step = "three";
    expect(isChatRecordShape(record)).toBe(false);
  });
});
