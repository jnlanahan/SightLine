import type React from "react";

// Line icons for the redesigned screen (docs/redesign/reference). Stroke
// icons on a 24 grid, coloured by `currentColor`, always aria-hidden: the
// button around them carries the label.

type P = { size?: number };

const svg = (size: number, sw: number, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const IconList = ({ size = 20 }: P) => svg(size, 1.8, <path d="M4 6h16M4 12h16M4 18h10" />);
export const IconCheck = ({ size = 14, stroke = 3 }: P & { stroke?: number }) =>
  svg(size, stroke, <path d="m5 12 5 5L20 7" />);
export const IconSpeaker = ({ size = 18 }: P) =>
  svg(size, 1.8, <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>);
export const IconSpeakerOff = ({ size = 18 }: P) =>
  svg(size, 1.8, <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 6 6M22 9l-6 6" /></>);
export const IconPause = ({ size = 18 }: P) => svg(size, 1.8, <path d="M9 5v14M15 5v14" />);
export const IconPlay = ({ size = 18 }: P) => svg(size, 1.8, <path d="M7 4.5v15l12-7.5z" />);
/** Collapse: chevrons pointing left. Expand reverses them. */
export const IconCollapse = ({ size = 18 }: P) => svg(size, 1.8, <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />);
export const IconExpand = ({ size = 18 }: P) => svg(size, 1.8, <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />);
