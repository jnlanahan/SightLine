import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/manrope";
import App from "./App";
import "./index.css";
import "./design/sightline.css";
import { SightLineTheme, makeTokens } from "./design/ThemeProvider";
import { DEFAULT_PALETTE } from "./design/tokens";
import { useSettings } from "./store/settings";
import type { PaletteName } from "./lib/api";

function DynamicTheme({ children }: { children: React.ReactNode }) {
  const palette = useSettings((s) => (s.settings?.palette ?? DEFAULT_PALETTE) as PaletteName);
  const accent = useSettings((s) => s.settings?.customAccent ?? null);
  const p = makeTokens(palette, accent).palette;
  // Expose the colour set to plain CSS (scrollbars, focus rings, keyframes,
  // and the lists Windows draws for drop-downs).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sl-bg", p.bg);
    root.style.setProperty("--sl-card", p.card);
    root.style.setProperty("--sl-accent", p.accent);
    root.style.setProperty("--sl-line", p.line);
    root.style.setProperty("--sl-ink", p.ink);
    // Tells the browser whether its own pieces (drop-down lists, the colour
    // picker, scrollbars) should be drawn dark or light.
    root.style.colorScheme = p.dark ? "dark" : "light";
  }, [p.bg, p.card, p.accent, p.line, p.ink, p.dark]);
  return (
    <SightLineTheme palette={palette} accent={accent}>
      {children}
    </SightLineTheme>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DynamicTheme>
      <App />
    </DynamicTheme>
  </React.StrictMode>,
);
