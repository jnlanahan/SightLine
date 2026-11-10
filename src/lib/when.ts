// Plain-words times for the chat list and the step log.
//
// Pure — callers pass `now` — so the wording is unit-testable.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Which day something happened, relative to today: "Today", "Yesterday", or a date. */
export function dayLabel(at: number, now: number): string {
  if (sameDay(at, now)) return "Today";
  if (sameDay(at, now - DAY)) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** How long ago, coarsely: "just now", "12 min ago", "3 h ago", then the day. */
export function timeAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (sameDay(at, now)) return `${Math.floor(elapsed / HOUR)} h ago`;
  return dayLabel(at, now);
}

/** Time of day, in the user's own format: "3:42 PM". */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
