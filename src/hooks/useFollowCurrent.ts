// Moving on without moving the reader (SPEC §6.2, §6.3, §6.5, §6.7; D6).
//
// When the coach finishes a step or a phase, the view follows only if the
// user was already at the bottom. Otherwise a "ready" pill appears and the
// view stays exactly where the user is reading. "At bottom" is judged from
// the user's own scrolling — so it is the state *before* the turn that moved
// things on, not after the new content made the page taller.
//
// Only three things scroll: a step, phase or goal finishing (this hook), a
// rail click (scrollToPhase / scrollToStep), and the first open of a chat.
// Speech streaming in, a silent look, an error banner or typing never do.

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PhaseView } from "../lib/phaseView";
import { motion } from "../design/tokens";

export type FollowTarget =
  | { type: "phase"; index: number }
  | { type: "step"; n: number }
  | { type: "done" };

export interface FollowSnapshot {
  currentPhase: number;
  currentStep: number;
  done: boolean;
  layout: PhaseView["layout"];
}

export type FollowAction =
  | { kind: "none" }
  | { kind: "scroll"; target: FollowTarget }
  | { kind: "pill"; label: string; target: FollowTarget };

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** SPEC §6.2: within 60 px of the bottom counts as at the bottom. */
export function isAtBottom(m: ScrollMetrics, threshold = motion.atBottomPx): boolean {
  return m.scrollTop + m.clientHeight >= m.scrollHeight - threshold;
}

function snapshotOf(view: PhaseView): FollowSnapshot {
  return { currentPhase: view.currentPhase, currentStep: view.currentStep, done: view.done, layout: view.layout };
}

/**
 * What a change in where the chat stands should do to the view. Pure.
 * A quick answer has nothing to move on to, so it never scrolls or pills.
 */
export function decideFollow(prev: FollowSnapshot, next: FollowSnapshot, atBottom: boolean): FollowAction {
  if (next.layout === "quick") return { kind: "none" };
  let target: FollowTarget | null = null;
  let label = "";
  if (next.done && !prev.done) {
    target = { type: "done" };
    label = "All done";
  } else if (!next.done && next.layout === "phased" && next.currentPhase > prev.currentPhase) {
    target = { type: "phase", index: next.currentPhase };
    label = `Phase ${next.currentPhase + 1} is ready`;
  } else if (!next.done && next.currentStep > prev.currentStep) {
    target = { type: "step", n: next.currentStep };
    label = `Step ${next.currentStep} is ready`;
  }
  if (!target) return { kind: "none" };
  return atBottom ? { kind: "scroll", target } : { kind: "pill", label, target };
}

/**
 * Where to scroll for a new step in the same phase, or null to stay put.
 * `stepTop` is the checkpoint's top relative to the viewport's top edge. Only
 * when it would sit within 140 px of the bottom edge does the view move, to
 * put it 16 px below the top.
 */
export function stepScrollTop(scrollTop: number, clientHeight: number, stepTop: number): number | null {
  if (stepTop <= clientHeight - motion.stepNearBottomPx) return null;
  return scrollTop + stepTop - motion.stepTopOffsetPx;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** An element's top relative to the scroll container's visible top edge. */
function topWithin(container: HTMLElement, el: Element): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

function selectorFor(target: FollowTarget, view: PhaseView): string {
  if (target.type === "step") return `[data-step="${target.n}"]`;
  if (target.type === "phase") return `[data-phase="${target.index}"]`;
  return `[data-phase="${view.phases.length}"]`;
}

/**
 * How long after a wheel, touch, key or press a scroll still counts as the
 * user's own. Long enough for a flick to coast to a stop.
 */
export const USER_SCROLL_WINDOW_MS = 1500;

export interface FollowCurrent {
  scrollRef: RefObject<HTMLDivElement>;
  onScroll(): void;
  /** The user reached for the scroll: a wheel, a touch, a key, a press. */
  onUserScroll(): void;
  /** The ready pill's words, or null when it is not shown. */
  pill: string | null;
  onPillClick(): void;
  scrollToPhase(index: number): void;
  scrollToStep(n: number): void;
  /** Put the current phase at the top, instantly — after the chat column is
   *  shown again (expanding the panel, closing About this chat). */
  landOnCurrent(): void;
}

/**
 * @param view     the phase view model
 * @param chatKey  the open chat's id; a change is a first open (no animation,
 *                 current phase at the top)
 */
export function useFollowCurrent(view: PhaseView, chatKey: string | null): FollowCurrent {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevRef = useRef<FollowSnapshot>(snapshotOf(view));
  const chatRef = useRef<string | null | undefined>(undefined);
  const [pill, setPill] = useState<{ label: string; target: FollowTarget } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const scrollTo = useCallback((target: FollowTarget, instant = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const node = el.querySelector(selectorFor(target, viewRef.current));
    if (!node) return;
    const behavior: ScrollBehavior = instant || prefersReducedMotion() ? "auto" : "smooth";
    const rel = topWithin(el, node);
    if (target.type === "step") {
      const top = stepScrollTop(el.scrollTop, el.clientHeight, rel);
      if (top !== null) el.scrollTo({ top, behavior });
      return;
    }
    el.scrollTo({ top: el.scrollTop + rel, behavior });
  }, []);

  useLayoutEffect(() => {
    const next = snapshotOf(view);
    // First open of a chat: land on the current phase, no animation.
    if (chatRef.current !== chatKey) {
      chatRef.current = chatKey;
      prevRef.current = next;
      atBottomRef.current = true;
      setPill(null);
      if (view.layout === "phased" && !view.done) {
        scrollTo({ type: "phase", index: view.currentPhase }, true);
      }
      return;
    }
    const action = decideFollow(prevRef.current, next, atBottomRef.current);
    prevRef.current = next;
    if (action.kind === "scroll") {
      setPill(null);
      // A phase or the goal finishing scrolls the new section to the top;
      // the user is following, so they stay "at the bottom".
      scrollTo(action.target);
    } else if (action.kind === "pill") {
      setPill({ label: action.label, target: action.target });
    }
  }, [view.currentPhase, view.currentStep, view.done, view.layout, chatKey, scrollTo]);

  const userScrollAtRef = useRef(0);
  const onUserScroll = useCallback(() => {
    userScrollAtRef.current = Date.now();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only the user's own scrolling says whether they are following. The
    // browser also fires scroll events by itself: when the page grows it
    // nudges the position to hold the text steady, and our own smooth scrolls
    // pass through every point on the way. Tapping "I did it" swaps the
    // footer, the page grows a little, the browser nudges — and that used to
    // be read as the user scrolling away, so the next phase got a pill
    // instead of being followed (seen driving the real screen, 11 Nov 2026).
    if (Date.now() - userScrollAtRef.current > USER_SCROLL_WINDOW_MS) return;
    const bottom = isAtBottom(el);
    atBottomRef.current = bottom;
    if (bottom) setPill(null);
  }, []);

  const scrollToPhase = useCallback((index: number) => {
    // A rail click is the user choosing where to look. Going back to an
    // earlier phase is rereading: the view must not be pulled away from it.
    atBottomRef.current = index >= viewRef.current.currentPhase;
    const el = scrollRef.current;
    const node = el?.querySelector(`[data-phase="${index}"]`);
    if (!el || !node) return;
    el.scrollTo({ top: el.scrollTop + topWithin(el, node), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  const scrollToStep = useCallback((n: number) => {
    atBottomRef.current = n >= viewRef.current.currentStep;
    const el = scrollRef.current;
    const node = el?.querySelector(`[data-step="${n}"]`);
    if (!el || !node) return;
    el.scrollTo({
      top: el.scrollTop + topWithin(el, node) - motion.stepTopOffsetPx,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  const pillRef = useRef(pill);
  pillRef.current = pill;
  const onPillClick = useCallback(() => {
    const p = pillRef.current;
    setPill(null);
    atBottomRef.current = true;
    if (!p) return;
    if (p.target.type === "step") scrollToStep(p.target.n);
    else scrollTo(p.target, false);
  }, [scrollTo, scrollToStep]);

  const landOnCurrent = useCallback(() => {
    const v = viewRef.current;
    atBottomRef.current = true;
    if (v.layout === "phased" && !v.done) scrollTo({ type: "phase", index: v.currentPhase }, true);
    else {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
  }, [scrollTo]);

  return { scrollRef, onScroll, onUserScroll, landOnCurrent, pill: pill?.label ?? null, onPillClick, scrollToPhase, scrollToStep };
}
