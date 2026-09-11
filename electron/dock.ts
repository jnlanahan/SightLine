// Docked-sidebar manager: reserves a strip of a monitor via the Windows
// AppBar API (SHAppBarMessage — the same mechanism as the taskbar) so the OS
// work area shrinks and maximized/snapped windows sit BESIDE the coach.
//
// Invariants:
// - Never leave reserved space behind: ABM_REMOVE runs on undock, window
//   close, and app will-quit. (If the process dies the OS reclaims the space
//   when the HWND is destroyed — crash-safe by nature.)
// - koffi is loaded lazily in a try/catch: if the FFI layer can't load, every
//   call here no-ops and the app stays a floating window. Docking must never
//   make the app unusable.
// - AppBar rects are PHYSICAL pixels; everything else in the app is DIP.
//   Conversion goes through screen.dipToScreenRect/screenToDipRect only.

import { screen, type BrowserWindow, type Display } from "electron";
import { createRequire } from "node:module";
import {
  computeDockRect,
  RAIL_WIDTH,
  type DockSide,
  type Rect,
} from "./dock-geometry";

const require = createRequire(import.meta.url);

const ABM_NEW = 0;
const ABM_REMOVE = 1;
const ABM_QUERYPOS = 2;
const ABM_SETPOS = 3;
const ABE_LEFT = 0;
const ABE_RIGHT = 2;
// Private window message for AppBar notifications (WM_APP). We re-assert our
// rect when the shell says positions changed (taskbar moved, etc.).
const APPBAR_CALLBACK_MSG = 0x8000 + 0x51;

interface AppBarFfi {
  // SHAppBarMessage bound via koffi; pData is an _Inout_ APPBARDATA object.
  call(message: number, data: Record<string, unknown>): unknown;
  cbSize: number;
}

let ffi: AppBarFfi | null | undefined; // undefined = not tried yet, null = failed

function getFfi(): AppBarFfi | null {
  if (ffi !== undefined) return ffi;
  try {
    const koffi = require("koffi");
    const RECT = koffi.struct("SL_RECT", {
      left: "int32",
      top: "int32",
      right: "int32",
      bottom: "int32",
    });
    const APPBARDATA = koffi.struct("SL_APPBARDATA", {
      cbSize: "uint32", // koffi pads to 8 before hWnd, like the C compiler
      hWnd: "uintptr_t",
      uCallbackMessage: "uint32",
      uEdge: "uint32",
      rc: RECT,
      lParam: "intptr_t",
    });
    const shell32 = koffi.load("shell32.dll");
    const fn = shell32.func(
      "uintptr_t __stdcall SHAppBarMessage(uint32 dwMessage, _Inout_ SL_APPBARDATA *pData)",
    );
    ffi = {
      call: (message, data) => fn(message, data),
      cbSize: koffi.sizeof(APPBARDATA),
    };
    console.log(`[dock] koffi loaded, APPBARDATA size=${ffi.cbSize}`);
  } catch (err) {
    console.error(
      "[dock] koffi failed to load — docking disabled, staying floating:",
      err,
    );
    ffi = null;
  }
  return ffi;
}

export function isDockingAvailable(): boolean {
  return getFfi() !== null;
}

interface DockState {
  win: BrowserWindow;
  hwnd: bigint;
  displayId: string;
  side: DockSide;
  widthDip: number; // current strip width (rail or expanded)
  floatingBounds: Rect;
  floatingMinSize: [number, number];
  closedListener: () => void;
}

let state: DockState | null = null;
let changeListener:
  | ((s: { docked: boolean; rect: Rect | null; displayLost?: boolean }) => void)
  | null = null;
let screenListenersInstalled = false;
let reassertTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

export function setDockChangeListener(
  cb: (s: { docked: boolean; rect: Rect | null; displayLost?: boolean }) => void,
): void {
  changeListener = cb;
}

function notifyChange(displayLost = false): void {
  changeListener?.({
    docked: state !== null,
    rect: state ? currentDockRectDip() : null,
    displayLost,
  });
}

export function isDocked(): boolean {
  return state !== null;
}

function findDisplay(displayId: string): Display | null {
  return (
    screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? null
  );
}

function currentDockRectDip(): Rect | null {
  if (!state) return null;
  const display = findDisplay(state.displayId);
  if (!display) return null;
  return computeDockRect(display.bounds, state.side, state.widthDip);
}

export function getDockRectDip(): { displayId: string; rect: Rect } | null {
  const rect = currentDockRectDip();
  if (!state || !rect) return null;
  return { displayId: state.displayId, rect };
}

function readHwnd(win: BrowserWindow): bigint {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8
    ? buf.readBigUInt64LE(0)
    : BigInt(buf.readUInt32LE(0));
}

// QUERYPOS/SETPOS handshake for the current state; positions the window on
// the granted rect. Used for the initial dock and every width/metrics change.
function assertAppBarRect(): boolean {
  const f = getFfi();
  if (!f || !state) return false;
  const display = findDisplay(state.displayId);
  if (!display) return false;

  const dipRect = computeDockRect(display.bounds, state.side, state.widthDip);
  // AppBar rects are physical pixels; null = use the display containing the rect.
  const px = screen.dipToScreenRect(null, dipRect);
  const widthPx = Math.max(1, Math.round(state.widthDip * display.scaleFactor));

  const abd: Record<string, unknown> = {
    cbSize: f.cbSize,
    hWnd: state.hwnd,
    uCallbackMessage: APPBAR_CALLBACK_MSG,
    uEdge: state.side === "left" ? ABE_LEFT : ABE_RIGHT,
    rc: {
      left: px.x,
      top: px.y,
      right: px.x + px.width,
      bottom: px.y + px.height,
    },
    lParam: 0,
  };

  f.call(ABM_QUERYPOS, abd);
  // The system may have nudged the rect (another appbar / docked toolbar).
  // Re-impose our width on whichever edge we own, then commit.
  const rc = abd.rc as { left: number; top: number; right: number; bottom: number };
  if (state.side === "left") rc.right = rc.left + widthPx;
  else rc.left = rc.right - widthPx;
  f.call(ABM_SETPOS, abd);

  const granted = screen.screenToDipRect(null, {
    x: rc.left,
    y: rc.top,
    width: rc.right - rc.left,
    height: rc.bottom - rc.top,
  });
  state.win.setBounds(granted);
  // The SETPOS work-area broadcast makes the shell shove ordinary windows out
  // of the reserved strip — including ours, right after we move into it
  // (verified: bounds drift to workArea+8px without this). Re-assert once
  // after the cascade settles; only the appbar owner may sit in its strip.
  // One shared timer: a live drag-resize calls this many times a second, and
  // a timer per call replayed every stale width in sequence at the end.
  const win = state.win;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (state?.win === win && !win.isDestroyed()) win.setBounds(granted);
  }, 350);
  return true;
}

function scheduleReassert(): void {
  if (!state) return;
  if (reassertTimer) clearTimeout(reassertTimer);
  reassertTimer = setTimeout(() => {
    reassertTimer = null;
    if (!state) return;
    if (!findDisplay(state.displayId)) {
      // The docked display disappeared — release the reservation and tell
      // main so it can redock to the re-resolved watched display.
      console.warn("[dock] docked display disappeared — undocking");
      undockWindow();
      notifyChange(true);
      return;
    }
    assertAppBarRect();
    notifyChange();
  }, 1_000);
}

function installScreenListeners(): void {
  if (screenListenersInstalled) return;
  screenListenersInstalled = true;
  screen.on("display-metrics-changed", scheduleReassert);
  screen.on("display-removed", scheduleReassert);
  screen.on("display-added", scheduleReassert);
}

export function dockWindow(
  win: BrowserWindow,
  display: Display,
  side: DockSide,
  widthDip: number,
): boolean {
  const f = getFfi();
  if (!f) return false;
  if (state) {
    // Already docked — treat as a move: undock cleanly first.
    undockWindow();
  }
  if (win.isMinimized()) win.restore();

  const b = win.getBounds();
  const [minW, minH] = win.getMinimumSize();
  const closedListener = () => {
    // Window died while docked — release the reserved strip.
    if (state?.win === win) {
      removeAppBar();
      state = null;
      notifyChange();
    }
  };

  state = {
    win,
    hwnd: readHwnd(win),
    displayId: String(display.id),
    side,
    widthDip,
    floatingBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    floatingMinSize: [minW, minH],
    closedListener,
  };

  const abd: Record<string, unknown> = {
    cbSize: f.cbSize,
    hWnd: state.hwnd,
    uCallbackMessage: APPBAR_CALLBACK_MSG,
    uEdge: side === "left" ? ABE_LEFT : ABE_RIGHT,
    rc: { left: 0, top: 0, right: 0, bottom: 0 },
    lParam: 0,
  };
  f.call(ABM_NEW, abd);

  // The rail (64) is far below the floating minimum — shrink limits before
  // setBounds or the OS-granted rect gets silently blocked.
  win.setMinimumSize(RAIL_WIDTH, 200);
  win.setResizable(false);
  win.setMovable(false);
  win.once("closed", closedListener);
  // Shell notifications (taskbar moved/resized) → re-assert our strip.
  try {
    win.hookWindowMessage(APPBAR_CALLBACK_MSG, () => scheduleReassert());
  } catch (err) {
    console.warn("[dock] hookWindowMessage failed (non-fatal):", err);
  }
  installScreenListeners();

  if (!assertAppBarRect()) {
    console.error("[dock] SETPOS failed — rolling back to floating");
    undockWindow();
    return false;
  }
  console.log(
    `[dock] docked ${side} on display=${state.displayId} width=${widthDip}dip`,
  );
  notifyChange();
  return true;
}

export function updateDockWidth(widthDip: number): void {
  if (!state) return;
  state.widthDip = Math.round(widthDip);
  assertAppBarRect();
  notifyChange();
}

// The saved floating bounds may sit on a monitor that has since been
// unplugged (that is one of the reasons we undock). Restoring there would put
// the window off-screen; pull it onto the nearest live display's work area.
function clampToLiveDisplay(b: Rect): Rect {
  const display = screen.getDisplayMatching({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  });
  const wa = display.workArea;
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - height));
  return { x, y, width, height };
}

function removeAppBar(): void {
  const f = getFfi();
  if (!f || !state) return;
  const abd: Record<string, unknown> = {
    cbSize: f.cbSize,
    hWnd: state.hwnd,
    uCallbackMessage: APPBAR_CALLBACK_MSG,
    uEdge: 0,
    rc: { left: 0, top: 0, right: 0, bottom: 0 },
    lParam: 0,
  };
  f.call(ABM_REMOVE, abd);
}

export function undockWindow(): void {
  if (!state) return;
  if (reassertTimer) {
    clearTimeout(reassertTimer);
    reassertTimer = null;
  }
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  removeAppBar();
  const { win, floatingBounds, floatingMinSize, closedListener } = state;
  state = null;
  if (!win.isDestroyed()) {
    win.removeListener("closed", closedListener);
    try {
      win.unhookWindowMessage(APPBAR_CALLBACK_MSG);
    } catch {
      // never hooked
    }
    win.setMinimumSize(floatingMinSize[0], floatingMinSize[1]);
    win.setResizable(true);
    win.setMovable(true);
    win.setBounds(clampToLiveDisplay(floatingBounds));
  }
  console.log("[dock] undocked, floating bounds restored");
  notifyChange();
}
