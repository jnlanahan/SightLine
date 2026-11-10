// sightline/icons.tsx
// Line icons used across the SightLine overlay. Each inherits color via the
// `c` prop (defaults to currentColor).
import React from "react";

type IconProps = { c?: string };
const sq = { width: 19, height: 19 } as const;

// The coach's voice OUTPUT. Deliberately a speaker, not a microphone: a mic
// means input, and the hold-to-talk mic sits right next to these controls.
export const ISpeakerOn = ({ c = "currentColor" }: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill={c} fillOpacity="0.25" stroke={c} strokeWidth="1.4" strokeLinejoin="round" /><path d="M9.5 4.5c1 .8 1 4.2 0 5M11 3c1.6 1.4 1.6 6.6 0 8" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none" /></svg>
);
export const ISpeakerOff = ({ c = "currentColor" }: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill="none" stroke={c} strokeWidth="1.4" strokeLinejoin="round" /><path d="M9 5l3.5 4M12.5 5L9 9" stroke={c} strokeWidth="1.4" strokeLinecap="round" /></svg>
);
export const IPause = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><rect x="5.5" y="4" width="3.2" height="12" rx="1.2" fill={c} /><rect x="11.3" y="4" width="3.2" height="12" rx="1.2" fill={c} /></svg>
);
export const IGear = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.6" stroke={c} strokeWidth="1.6" /><path d="M10 2.4v2.2M10 15.4v2.2M17.6 10h-2.2M4.6 10H2.4M15.4 4.6l-1.6 1.6M6.2 13.8l-1.6 1.6M15.4 15.4l-1.6-1.6M6.2 6.2 4.6 4.6" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const ISend = ({ c = "currentColor" }: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V4M4.5 7.5 8 4l3.5 3.5" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IExpand = ({ c = "currentColor" }: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 6V2.5h3.5M12 6V2.5H8.5M2 8v3.5h3.5M12 8v3.5H8.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IChevron = ({ c = "currentColor" }: IconProps) => (
  <svg width="9" height="12" viewBox="0 0 9 12" fill="none"><path d="M2 1l5 5-5 5" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IMonitor = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><rect x="2.5" y="3.5" width="15" height="10" rx="1.8" stroke={c} strokeWidth="1.6" /><path d="M7 17h6M10 13.5V17" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const IMinimize = ({ c = "currentColor" }: IconProps) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8.5h8" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const IClose = ({ c = "currentColor" }: IconProps) => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 2l7 7M9 2l-7 7" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
);
