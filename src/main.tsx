import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/manrope";
import App from "./App";
import "./index.css";
import "./design/sightline.css";
import { SightLineTheme } from "./design/ThemeProvider";
import { DEFAULT_PALETTE, PALETTES } from "./design/tokens";
import { useSettings } from "./store/settings";
import type { PaletteName } from "./lib/api";

function DynamicTheme({ children }: { children: React.ReactNode }) {
  const palette = useSettings((s) => (s.settings?.palette ?? DEFAULT_PALETTE) as PaletteName);
  const p = PALETTES[palette] ?? PALETTES[DEFAULT_PALETTE];
  // Expose the colour set to plain CSS (scrollbars, focus rings, keyframes).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sl-bg", p.bg);
    root.style.setProperty("--sl-accent", p.accent);
    root.style.setProperty("--sl-line", p.line);
    root.style.setProperty("--sl-ink", p.ink);
  }, [p]);
  return <SightLineTheme palette={palette}>{children}</SightLineTheme>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DynamicTheme>
      <App />
    </DynamicTheme>
  </React.StrictMode>,
);
