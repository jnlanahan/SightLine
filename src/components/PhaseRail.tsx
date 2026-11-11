// The phase rail (docs/redesign/SPEC.md §3, §3.6, §5): the plan as numbered
// circles in a 64 px strip down the left of the panel. Expanded, it sits
// beside the phase chat; collapsed, it is the whole docked panel.
//
// Renders only what the view model (src/lib/phaseView.ts) says. Three forms:
//   phased  — one circle per phase, with a dot per step under it
//   single  — one circle per step, no dots
//   quick   — no rail while expanded; collapsed, one accent circle
// The current circle carries the breathing halo: the one thing that moves
// while the coach is quiet (D10). Paused, needs-you and done turn it off.

import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { useTokens } from "../design/ThemeProvider";
import {
  IconCheck,
  IconCollapse,
  IconExpand,
  IconList,
  IconPause,
  IconPlay,
  IconSpeaker,
  IconSpeakerOff,
} from "../design/lineIcons";
import type { ItemState, PhaseView, StepVM } from "../lib/phaseView";

export interface PhaseRailProps {
  view: PhaseView;
  collapsed: boolean;
  muted: boolean;
  paused: boolean;
  /** Something needs the user (error, no key, cap, rate limit): halo off. */
  needsYou?: boolean;
  /** The coach is not looking (the goal waits on a yes): halo off. */
  haloOff?: boolean;
  /** The latest coach line, carried by the current circle while collapsed. */
  latestLine?: string;
  onAllChats(): void;
  /** A done or current phase circle (phased layout). */
  onPhase(index: number): void;
  /** A done or current step circle (single layout), by global step number. */
  onStep(n: number): void;
  onMute(): void;
  onPause(): void;
  onCollapse(): void;
}

const reset: CSSProperties = {
  border: 0,
  padding: 0,
  margin: 0,
  font: "inherit",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

export function PhaseRail(props: PhaseRailProps) {
  const { view, collapsed } = props;
  const { palette: t, size } = useTokens();

  // A quick answer has no plan, so no rail beside it (SPEC §3.4).
  if (view.layout === "quick" && !collapsed) return null;

  const iconButton = (
    label: string,
    onClick: () => void,
    icon: ReactNode,
    color: string,
    extra: Partial<ButtonHTMLAttributes<HTMLButtonElement>> = {},
  ) => (
    <button
      type="button"
      className="sl-focus no-drag"
      aria-label={label}
      onClick={onClick}
      {...extra}
      style={{
        ...reset,
        width: size.iconButton,
        height: size.iconButton,
        borderRadius: 10,
        background: "transparent",
        color,
      }}
    >
      {icon}
    </button>
  );

  return (
    <nav
      aria-label="Plan"
      style={{
        width: size.rail,
        flexShrink: 0,
        height: "100%",
        boxSizing: "border-box",
        background: t.rail,
        borderRight: `1px solid ${t.line}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 0 10px",
        overflow: "hidden",
      }}
    >
      {iconButton("All chats", props.onAllChats, <IconList size={20} />, t.ink)}

      {view.layout === "quick" ? (
        <QuickMark {...props} />
      ) : (
        <RailList {...props} />
      )}

      <div style={{ flex: 1, minHeight: 8 }} />
      {iconButton(
        props.muted ? "Turn voice on" : "Mute voice",
        props.onMute,
        props.muted ? <IconSpeakerOff size={18} /> : <IconSpeaker size={18} />,
        t.ink2,
        { title: props.muted ? "Voice is muted" : undefined, "aria-pressed": props.muted },
      )}
      {iconButton(
        props.paused ? "Resume watching" : "Pause watching",
        props.onPause,
        props.paused ? <IconPlay size={18} /> : <IconPause size={18} />,
        t.ink2,
      )}
      {iconButton(
        collapsed ? "Expand" : "Collapse to rail",
        props.onCollapse,
        collapsed ? <IconExpand size={18} /> : <IconCollapse size={18} />,
        t.ink2,
      )}
    </nav>
  );
}

// ── The scrolling list of circles ──

interface RailItem {
  key: string;
  state: ItemState;
  num: number;
  label: string;
  title: string;
  dots: StepVM[];
  onClick?: () => void;
}

function railItems(p: PhaseRailProps): RailItem[] {
  const { view } = p;
  if (view.layout === "phased") {
    return view.phases.map((ph, i) => ({
      key: `p${i}`,
      state: ph.state,
      num: i + 1,
      label: `Phase ${i + 1}, ${ph.state}: ${ph.title}`,
      title: ph.title,
      dots: ph.state === "upcoming" ? [] : ph.steps,
      onClick: ph.state === "upcoming" ? undefined : () => p.onPhase(i),
    }));
  }
  // Single: the steps themselves are the circles.
  return (view.phases[0]?.steps ?? []).map((s) => ({
    key: `s${s.n}`,
    state: s.state,
    num: s.n,
    label: `Step ${s.n}, ${s.state}${s.title ? `: ${s.title}` : ""}`,
    title: s.title,
    dots: [],
    onClick: s.state === "upcoming" ? undefined : () => p.onStep(s.n),
  }));
}

function RailList(p: PhaseRailProps) {
  const { palette: t, size } = useTokens();
  const single = p.view.layout === "single";
  const items = railItems(p);
  const listRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);
  const [cut, setCut] = useState({ top: false, bottom: false });
  const currentKey = items.find((i) => i.state === "current")?.key ?? null;

  const measure = () => {
    const el = listRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setCut((c) => (c.top === top && c.bottom === bottom ? c : { top, bottom }));
  };

  // Keep the current circle in view (SPEC §3.2), without scrolling anything
  // but the rail's own list.
  useLayoutEffect(() => {
    const list = listRef.current;
    const cur = currentRef.current;
    if (list && cur) {
      const top = cur.offsetTop - list.offsetTop;
      const bottom = top + cur.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 16;
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight + 16;
      }
    }
    measure();
  }, [currentKey, items.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fade = 16;
  const mask =
    cut.top || cut.bottom
      ? `linear-gradient(to bottom, ${cut.top ? "transparent 0" : "#000 0"}, #000 ${fade}px, #000 calc(100% - ${fade}px), ${cut.bottom ? "transparent 100%" : "#000 100%"})`
      : undefined;

  const circle = {
    done: single ? size.circle.singleDone : size.circle.done,
    current: single ? size.circle.singleCurrent : size.circle.current,
    upcoming: single ? size.circle.singleDone : size.circle.upcoming,
  };
  const connectorH = single ? size.connector.hSingle : size.connector.h;

  return (
    <div
      ref={listRef}
      className="sl-rail-list"
      onScroll={measure}
      style={{
        // 28 below the top button (SPEC §3.2); 12 of it is padding so the
        // halo is never clipped by the list's own edge.
        marginTop: 16,
        padding: "12px 0",
        width: "100%",
        minHeight: 0,
        flex: "0 1 auto",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    >
      {items.map((item, i) => {
        const above = items[i - 1];
        const connector =
          i === 0
            ? null
            : above.state === "done"
              ? t.doneFill
              : item.state === "current"
                ? t.accent
                : t.line;
        return (
          <div key={item.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            {connector && (
              <div aria-hidden="true" style={{ width: size.connector.w, height: connectorH, background: connector }} />
            )}
            <div ref={item.state === "current" ? currentRef : undefined}>
              <Circle item={item} rail={p} single={single} sizes={circle} />
            </div>
            {item.dots.length > 0 && (
              <div
                aria-hidden="true"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 8 }}
              >
                {item.dots.map((d) => (
                  <span
                    key={d.n}
                    style={{
                      width: size.dot,
                      height: size.dot,
                      borderRadius: "50%",
                      background: d.state === "done" ? t.doneFill : d.state === "current" ? t.accent : t.muted,
                      boxShadow: d.added ? `0 0 0 2px ${t.rail}, 0 0 0 3.5px ${t.accent}` : undefined,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Circle({
  item,
  rail,
  single,
  sizes,
}: {
  item: RailItem;
  rail: PhaseRailProps;
  single: boolean;
  sizes: { done: number; current: number; upcoming: number };
}) {
  const { palette: t } = useTokens();

  if (item.state === "done") {
    return (
      <button
        type="button"
        className="sl-focus no-drag"
        aria-label={item.label}
        title={item.title || undefined}
        onClick={item.onClick}
        style={{
          ...reset,
          width: sizes.done,
          height: sizes.done,
          borderRadius: "50%",
          background: t.doneFill,
          color: t.doneInk,
        }}
      >
        <IconCheck size={single ? 12 : 14} stroke={3} />
      </button>
    );
  }

  if (item.state === "upcoming") {
    return (
      <div
        role="img"
        aria-label={item.label}
        title={item.title || undefined}
        style={{
          width: sizes.upcoming,
          height: sizes.upcoming,
          boxSizing: "border-box",
          border: `1.5px solid ${t.muted}`,
          borderRadius: "50%",
          color: t.ink2,
          fontSize: single ? 12 : 13,
          fontWeight: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.num}
      </div>
    );
  }

  // Current.
  const d = sizes.current;
  const latest = rail.collapsed ? rail.latestLine?.trim() : "";
  return (
    <div style={{ position: "relative", width: d, height: d, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Halo rail={rail} />
      <button
        type="button"
        className="sl-focus no-drag"
        aria-label={item.label}
        aria-description={latest || undefined}
        title={latest || item.title || undefined}
        onClick={item.onClick}
        style={{
          ...reset,
          position: "relative",
          width: d,
          height: d,
          borderRadius: "50%",
          background: rail.paused ? t.muted : t.accent,
          color: rail.paused ? t.ink : t.onAccent,
          fontSize: single ? 14 : 16,
          fontWeight: 700,
        }}
      >
        {rail.paused ? <IconPause size={single ? 14 : 16} /> : item.num}
      </button>
    </div>
  );
}

/** The breathing halo. Off while paused, while something needs the user,
 *  and once the goal is reached (SPEC §7). */
function Halo({ rail }: { rail: PhaseRailProps }) {
  const { palette: t } = useTokens();
  if (rail.paused || rail.needsYou || rail.haloOff || rail.view.done) return null;
  return (
    <div
      className="sl-halo"
      aria-hidden="true"
      style={{ background: `radial-gradient(circle, ${t.accent} 0%, transparent 70%)` }}
    />
  );
}

/** Collapsed quick answer: one 34 px accent circle, a check when done or the
 *  halo and a dot while watching (SPEC §5). */
function QuickMark(rail: PhaseRailProps) {
  const { palette: t, size } = useTokens();
  const d = size.circle.singleCurrent;
  const done = rail.view.done;
  const word = done ? "Done" : rail.paused ? "Paused" : rail.needsYou ? "Needs you" : "Watching";
  const latest = rail.latestLine?.trim();
  return (
    <div style={{ marginTop: 28, position: "relative", width: d, height: d, flexShrink: 0 }}>
      <Halo rail={rail} />
      <div
        role="img"
        aria-label={word}
        aria-description={latest || undefined}
        title={latest || word}
        style={{
          position: "relative",
          width: d,
          height: d,
          borderRadius: "50%",
          background: rail.paused ? t.muted : t.accent,
          color: rail.paused ? t.ink : t.onAccent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done ? (
          <IconCheck size={14} stroke={3} />
        ) : rail.paused ? (
          <IconPause size={14} />
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.onAccent }} />
        )}
      </div>
    </div>
  );
}
