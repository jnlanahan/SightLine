import { describe, it, expect } from "vitest";
import {
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_MIN,
  DOCK_WIDTH_MAX,
  RAIL_WIDTH,
} from "../../electron/dock-geometry";

// Guard tests: the Coach Mode dock defaults are product decisions, not
// implementation details. Changing one means updating this test deliberately.

describe("dock settings defaults (settings-store.ts)", () => {
  it("docks by default, on the left, at 400 DIP", async () => {
    const src = await import("../../electron/settings-store?raw");
    const content = (src as unknown as { default: string }).default;
    expect(content).toContain("dockEnabled: true");
    expect(content).toContain('dockSide: "left"');
    expect(content).toContain("dockWidth: 400");
  });

  it("defaults to the Graphite colour set (redesign D9)", async () => {
    const src = await import("../../electron/settings-store?raw");
    const content = (src as unknown as { default: string }).default;
    expect(content).toContain('palette: "graphite"');
  });
});

describe("dock geometry constants", () => {
  it("locks the width envelope", () => {
    expect(DOCK_WIDTH_DEFAULT).toBe(400);
    expect(DOCK_WIDTH_MIN).toBe(340);
    expect(DOCK_WIDTH_MAX).toBe(520);
    expect(RAIL_WIDTH).toBe(64);
  });
});
