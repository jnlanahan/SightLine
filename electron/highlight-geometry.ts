// Where the pointer box goes on the real screen.
//
// The coach gives a box as fractions of the screenshot it was shown. This
// turns that into pixels inside the glow window, which is what draws it.
//
// The box is meant to FIT what it points at. It used to be padded by about
// 19 px on every side with a 44 px floor, on the theory that the coach's
// estimate was a percent or two off; a 32 px button got a 70 px box, and the
// owner's verdict in the second live run was "a really big box for a small
// little thing". Measured against a screenshot with known positions on
// 11 November 2026 (twelve tries, Sonnet 5.5), the coach's own box covered
// the target every time with 1 to 6 px to spare. So the app now adds only
// enough for the border to sit just outside the control instead of on it.
//
// Pure module — no Electron — so it is unit-tested.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Space between the control's edge and the box's border, each side. */
export const HIGHLIGHT_PAD_PX = 6;
/** Smaller than this and the box is hard to spot at all. */
export const HIGHLIGHT_MIN_SIDE_PX = 28;

/**
 * @param frac        the coach's box, as 0-1 fractions of the captured frame
 * @param captured    the part of the display that frame showed, relative to
 *                    the display's top-left
 * @param windowAt    the glow window's top-left, relative to the same display
 * @param windowSize  the glow window's size
 * @returns the box in the glow window's own coordinates, kept whole inside it
 */
export function highlightRect(
  frac: { x: number; y: number; w: number; h: number },
  captured: Rect,
  windowAt: { x: number; y: number },
  windowSize: { width: number; height: number },
): Rect {
  const width = Math.min(
    windowSize.width,
    Math.max(HIGHLIGHT_MIN_SIDE_PX, Math.round(frac.w * captured.width) + HIGHLIGHT_PAD_PX * 2),
  );
  const height = Math.min(
    windowSize.height,
    Math.max(HIGHLIGHT_MIN_SIDE_PX, Math.round(frac.h * captured.height) + HIGHLIGHT_PAD_PX * 2),
  );
  const cx = captured.x + (frac.x + frac.w / 2) * captured.width - windowAt.x;
  const cy = captured.y + (frac.y + frac.h / 2) * captured.height - windowAt.y;
  // Kept whole on screen: a target at the very edge (an icon on the taskbar)
  // used to get a box that ran off the bottom of the display.
  const x = Math.min(Math.max(0, Math.round(cx - width / 2)), windowSize.width - width);
  const y = Math.min(Math.max(0, Math.round(cy - height / 2)), windowSize.height - height);
  return { x, y, width, height };
}
