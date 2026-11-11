// The current phase's footer (redesign SPEC §4.6) and the pointing flag.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseFooter, FOOTER_NOT_POINTING, FOOTER_POINTING, type PhaseFooterProps } from "../components/phase/PhaseFooter";
import { ReadyPill } from "../components/phase/ReadyPill";
import { SightLineTheme } from "../design/ThemeProvider";
import { CHECK_WORK_REPLY, GOAL_AGREED_REPLY, STEP_DONE_REPLY, STUCK_REPLY } from "../lib/quickReplies";
import { useSession } from "../store/session";

const html = (props: Partial<PhaseFooterProps>) =>
  renderToStaticMarkup(
    createElement(SightLineTheme, {
      children: createElement(PhaseFooter, { stance: "guide", pointing: false, onReply: () => {}, ...props }),
    }),
  );

const esc = (s: string) => s.replace(/'/g, "&#x27;");

describe("phase footer", () => {
  it("guiding: I did it and I'm stuck, with the plain promise", () => {
    const h = html({});
    expect(h).toContain(">I did it<");
    expect(h).toContain(esc(">I'm stuck<"));
    expect(h).toContain(esc(FOOTER_NOT_POINTING));
    expect(h).not.toContain("Outlined on your screen");
  });

  it("pointing: says the thing is outlined on screen", () => {
    expect(html({ pointing: true })).toContain(esc(FOOTER_POINTING));
  });

  it("watching: Check my work and I'm stuck, and no note", () => {
    const h = html({ stance: "watch", pointing: true });
    expect(h).toContain(">Check my work<");
    expect(h).not.toContain(">I did it<");
    expect(h).not.toContain("move on when I see");
  });

  it("while the coach looks after a reply: a status row instead of the pills", () => {
    const h = html({ statusRow: "Checking your screen" });
    expect(h).toContain('role="status"');
    expect(h).toContain("Checking your screen");
    expect(h).not.toContain(">I did it<");
  });

  it("goal waiting: one filled Yes, start and the correction line", () => {
    const h = html({ goalPending: true });
    expect(h).toContain(">Yes, start<");
    expect(h).toContain("Not quite? Type or say what you want instead.");
    expect(h).not.toContain(">I did it<");
  });

  it("paused: one Resume watching pill", () => {
    const h = html({ paused: true });
    expect(h).toContain(">Resume watching<");
    expect(h).not.toContain(">I did it<");
  });

  it("sends exactly the words in quickReplies.ts", async () => {
    // Render for real and click, so the wiring — not just the labels — is
    // checked.
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const sent: string[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const click = (label: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
    for (const [props, labels] of [
      [{ stance: "guide" as const }, ["I did it", "I'm stuck"]],
      [{ stance: "watch" as const }, ["Check my work"]],
      [{ stance: "guide" as const, goalPending: true }, ["Yes, start"]],
    ] as const) {
      act(() =>
        root.render(
          createElement(SightLineTheme, {
            children: createElement(PhaseFooter, { pointing: false, onReply: (t: string) => sent.push(t), ...props }),
          }),
        ),
      );
      for (const l of labels) act(() => click(l));
    }
    act(() => root.unmount());
    host.remove();
    expect(sent).toEqual([STEP_DONE_REPLY, STUCK_REPLY, CHECK_WORK_REPLY, GOAL_AGREED_REPLY]);
  });
});

describe("ready pill", () => {
  it("is a button with the words and the down arrow", () => {
    const h = renderToStaticMarkup(
      createElement(SightLineTheme, { children: createElement(ReadyPill, { label: "Phase 3 is ready", onClick: vi.fn() }) }),
    );
    expect(h).toContain("<button");
    expect(h).toContain("Phase 3 is ready");
    expect(h).toContain("bottom:76px");
  });
});

describe("pointing flag", () => {
  beforeEach(() => useSession.getState().reset());

  it("is set by the loop where it flashes a highlight, and nowhere else in the loop", async () => {
    const src = ((await import("../hooks/useSessionLoop?raw")) as unknown as { default: string }).default;
    expect(src.split("setPointing(").length - 1).toBe(1);
    expect(src).toMatch(/flashHighlight\(result\.highlight\);\s*\n\s*useSession\.getState\(\)\.setPointing\(true\);/);
  });

  it("clears when the instruction changes, and survives the same line again", () => {
    const s = useSession.getState();
    s.setInstruction("Click Add VPN.");
    s.setPointing(true);
    s.setInstruction("Click Add VPN.");
    expect(useSession.getState().pointing).toBe(true);
    s.setInstruction("Paste the server.");
    expect(useSession.getState().pointing).toBe(false);
  });

  it("is cleared with the session", () => {
    useSession.getState().setPointing(true);
    useSession.getState().reset();
    expect(useSession.getState().pointing).toBe(false);
  });
});
