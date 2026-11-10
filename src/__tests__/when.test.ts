// Plain-words times for the chat list and the step log.

import { describe, expect, it } from "vitest";
import { dayLabel, timeAgo } from "../lib/when";

// Local-time constructors on purpose: "today" is a local-calendar idea.
const noon = new Date(2026, 10, 9, 12, 0, 0).getTime();

describe("timeAgo", () => {
  it("says just now inside a minute", () => {
    expect(timeAgo(noon - 20_000, noon)).toBe("just now");
  });

  it("counts minutes, then hours, within the same day", () => {
    expect(timeAgo(noon - 12 * 60_000, noon)).toBe("12 min ago");
    expect(timeAgo(noon - 3 * 3_600_000, noon)).toBe("3 h ago");
  });

  it("switches to the day once it was not today", () => {
    const lastNight = new Date(2026, 10, 8, 23, 30, 0).getTime();
    expect(timeAgo(lastNight, noon)).toBe("Yesterday");
  });

  it("never reports a negative wait", () => {
    expect(timeAgo(noon + 5_000, noon)).toBe("just now");
  });
});

describe("dayLabel", () => {
  it("names today and yesterday", () => {
    expect(dayLabel(new Date(2026, 10, 9, 0, 5, 0).getTime(), noon)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 8, 9, 0, 0).getTime(), noon)).toBe("Yesterday");
  });

  it("gives a date for anything older", () => {
    const label = dayLabel(new Date(2026, 10, 3, 9, 0, 0).getTime(), noon);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label).toMatch(/3/);
  });
});
