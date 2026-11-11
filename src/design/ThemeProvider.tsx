// sightline/ThemeProvider.tsx
import React, { createContext, useContext, useMemo } from "react";
import type { SightLineTheme } from "./theme";
import { PALETTE_TO_LEGACY_ACCENT, makeTheme } from "./theme";
import {
  DEFAULT_PALETTE,
  PALETTES,
  font,
  motion,
  radius,
  size,
  type,
  type Palette,
  type PaletteName,
} from "./tokens";

/** Everything a redesigned component needs: the active colour set plus the
 *  fixed type, size, radius and motion scales (docs/redesign/SPEC.md). */
export interface DesignTokens {
  name: PaletteName;
  palette: Palette;
  font: typeof font;
  type: typeof type;
  size: typeof size;
  radius: typeof radius;
  motion: typeof motion;
}

export function makeTokens(name: PaletteName): DesignTokens {
  const palette = PALETTES[name] ?? PALETTES[DEFAULT_PALETTE];
  return { name: PALETTES[name] ? name : DEFAULT_PALETTE, palette, font, type, size, radius, motion };
}

const TokensCtx = createContext<DesignTokens>(makeTokens(DEFAULT_PALETTE));
const ThemeCtx = createContext<SightLineTheme>(makeTheme(PALETTE_TO_LEGACY_ACCENT[DEFAULT_PALETTE]));

/** Read the active palette and design scales inside any component. */
export const useTokens = (): DesignTokens => useContext(TokensCtx);

/** The pre-redesign theme, for screens not yet rebuilt (removed in WP8). */
export const useTheme = (): SightLineTheme => useContext(ThemeCtx);

/** Wrap the app (or a subtree) in a colour set. */
export function SightLineTheme({
  palette = DEFAULT_PALETTE,
  children,
}: {
  palette?: PaletteName;
  children: React.ReactNode;
}) {
  const tokens = useMemo(() => makeTokens(palette), [palette]);
  const legacy = useMemo(
    () => makeTheme(PALETTE_TO_LEGACY_ACCENT[tokens.name]),
    [tokens.name],
  );
  return (
    <TokensCtx.Provider value={tokens}>
      <ThemeCtx.Provider value={legacy}>{children}</ThemeCtx.Provider>
    </TokensCtx.Provider>
  );
}
