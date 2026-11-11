// The sitting-level tracking behind the phase view (redesign DATA §2–4):
// the current step's title, the layout floor, and plan-change notes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePhaseView, type LivePhaseView } from "../hooks/usePhaseView";
import { useSession } from "../store/session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let live: LivePhaseView;
let root: Root;
let host: HTMLDivElement;

function Probe() {
  live = usePhaseView();
  return null;
}

const s = () => useSession.getState();
const step = (fn: () => void) => act(fn);

beforeEach(() => {
  s().reset();
  host = document.createElement("div");
  root = createRoot(host);
  step(() => s().setSessionId("chat_one"));
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
});

describe("usePhaseView", () => {
  it("a quick question that becomes a walkthrough gets a plan note, and never drops back", () => {
    expect(live.view.layout).toBe("quick");
    step(() => {
      s().setInstruction("Open Settings.");
      s().setUpcomingSteps(["Click Network", "Click VPN"]);
    });
    expect(live.view.layout).toBe("single");
    expect(live.notes.map((n) => n.text)).toEqual(["Plan: 3 steps"]);
    expect(live.planArrivedAt).not.toBeNull();
    // Near the end the upcoming list empties: still a plan.
    step(() => {
      s().applyCompletedSteps(["Opened Settings", "Clicked Network"], 10);
      s().setUpcomingSteps([]);
    });
    expect(live.view.layout).toBe("single");
  });

  it("the current step takes the phrase the coach had queued for it", () => {
    step(() => {
      s().setInstruction("Open Settings.");
      s().setUpcomingSteps(["Click Network", "Click VPN"]);
    });
    step(() => {
      s().applyCompletedSteps(["Opened Settings"], 10);
      s().setUpcomingSteps(["Click VPN", "Add a connection"]);
      s().setInstruction("Now click Network.");
    });
    const cur = live.view.phases[0].steps.find((x) => x.state === "current")!;
    expect(cur.title).toBe("Click Network");
  });

  // The loop applies one look in this order, in one go: finished steps, the
  // coach's list, then the new instruction. A plain walkthrough, start to
  // finish, must draw no "Plan updated" note at all.
  it("a plain walkthrough draws no plan-change note, from the goal to the last step", () => {
    // The goal said back: the whole route is queued, nothing is in progress.
    step(() => s().setUpcomingSteps(["Open Settings", "Click Network", "Click VPN"]));
    // The user agrees; step one begins and leaves the queue.
    step(() => {
      s().setUpcomingSteps(["Click Network", "Click VPN"]);
      s().setInstruction("Press Windows and I to open Settings.");
    });
    // Each step finishes and the next begins.
    step(() => {
      s().applyCompletedSteps(["Opened Settings"], 10);
      s().setUpcomingSteps(["Click VPN", "Add a connection"]);
      s().setInstruction("Click Network & internet.");
    });
    step(() => {
      s().applyCompletedSteps(["Opened Settings", "Clicked Network"], 20);
      s().setUpcomingSteps(["Add a connection"]);
      s().setInstruction("Click VPN.");
    });
    // A silent look in between changes nothing.
    step(() => s().setUpcomingSteps(["Add a connection"]));
    step(() => {
      s().applyCompletedSteps(["Opened Settings", "Clicked Network", "Clicked VPN"], 30);
      s().setUpcomingSteps([]);
      s().setInstruction("Click Add VPN.");
    });
    expect(live.notes.map((n) => n.text).filter((t) => t.startsWith("Plan updated"))).toEqual([]);
    expect(live.addedSteps.size).toBe(0);
  });

  it("a step inserted as the next one begins is noted once, as added", () => {
    step(() => {
      s().setInstruction("Click Add VPN.");
      s().setUpcomingSteps(["Name the connection", "Save"]);
    });
    step(() => {
      s().applyCompletedSteps(["Clicked Add VPN"], 10);
      s().setUpcomingSteps(["Install the certificate", "Save"]);
      s().setInstruction("Type Work in the name box.");
    });
    step(() => {
      s().applyCompletedSteps(["Clicked Add VPN", "Named it"], 20);
      s().setUpcomingSteps(["Save"]);
      s().setInstruction("Open the certificate file and click Install.");
    });
    expect(live.notes.map((n) => n.text).filter((t) => t.startsWith("Plan updated"))).toEqual([
      'Plan updated: added "Install the certificate"',
    ]);
  });

  it("an inserted step is marked Added and noted; tail growth is not", () => {
    step(() => {
      s().setInstruction("Open Settings.");
      s().setUpcomingSteps(["A", "B", "C"]);
    });
    const before = live.notes.length;
    step(() => s().setUpcomingSteps(["A", "B", "C", "D"]));
    expect(live.notes.length).toBe(before);
    step(() => s().setUpcomingSteps(["A", "Install the certificate", "B"]));
    expect(live.notes.at(-1)!.text).toBe('Plan updated: added "Install the certificate"');
    expect(live.addedSteps.has("install the certificate")).toBe(true);
    const up = live.view.phases[0].steps.find((x) => x.title === "Install the certificate")!;
    expect(up.added).toBe(true);
  });

  it("opening a different chat starts clean", () => {
    step(() => {
      s().setInstruction("Open Settings.");
      s().setUpcomingSteps(["A", "B"]);
    });
    expect(live.notes.length).toBeGreaterThan(0);
    step(() => {
      s().reset();
      s().setSessionId("chat_two");
      s().applyStages(["One", "Two"], 1);
      s().setInstruction("Do it.");
      s().setUpcomingSteps(["X"]);
    });
    expect(live.notes).toEqual([]);
    expect(live.view.layout).toBe("phased");
    expect(live.planArrivedAt).toBeNull();
  });
});
