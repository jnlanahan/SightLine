import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadSettings, saveSettings } from "./settings-store";
import {
  captureFrame,
  getLastCaptureGeometry,
  listCaptureTargets,
} from "./capture";
import { getLogPath, logLine } from "./log";
import {
  getCalibration,
  initCalibration,
  invalidateCalibration,
} from "./calibrate";
import {
  dockWindow,
  undockWindow,
  updateDockWidth,
  isDocked,
  isDockingAvailable,
  getDockRectDip,
  setDockChangeListener,
} from "./dock";
import { clampDockWidth, RAIL_WIDTH, subtractDockStrip } from "./dock-geometry";
import { hasKey, setKey } from "./credentials";
import {
  detailTrainingModule,
  getClarifications,
  getCurriculumOutline,
  getGoalEvaluation,
  getNextInstruction,
  getSessionPlan,
  runWebResearch,
  MissingApiKeyError,
  RateLimitError,
  type NextInstructionArgs,
} from "./claude";
import { describeAgent } from "./agents/registry";
import { MissingOpenAIKeyError, transcribe } from "./whisper";
import { hasGoogleCredentials } from "./google-tts";
import { speak as synthesizeSpeech, warmPhraseCache } from "./tts";
import { hasElevenLabsKey, listElevenVoices } from "./tts/elevenlabs";
import type {
  AppMode,
  CaptureFrame,
  CaptureRegion,
  Clarification,
  ConversationTurn,
  UploadedContext,
} from "./types";
import { uIOhook } from "uiohook-napi";
import { HoldDetector, isPushToTalkCode } from "./hotkey";
import {
  addFact,
  deletePlan,
  deleteSession,
  forgetFact,
  getSession,
  listFacts,
  listPlans,
  listSessions,
  loadPlanFrame,
  newId,
  savePlan,
  savePlanFrame,
  saveSession,
  touchFacts,
} from "./db/store";
import type {
  MemoryFact,
  MemoryKind,
  SessionRecord,
  TrainingPlan,
} from "./db/schema";
import {
  formatFactsForPrompt,
  isDuplicateFact,
  selectFacts,
} from "./memory-rank";

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const isDev = !app.isPackaged;

// Reject a promise that runs past `ms`. Used to bound external calls (TTS
// engines) so one hung request can't wedge a whole feature.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(label)), ms),
    ),
  ]);
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val) result[key] = val;
  }
  return result;
}

async function loadKeysFromEnv() {
  const envPaths = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "../.env"),
    path.join(app.getPath("userData"), ".env"),
  ];
  let envVars: Record<string, string> = {};
  for (const p of envPaths) {
    try {
      envVars = parseEnvFile(fs.readFileSync(p, "utf-8"));
      break;
    } catch { /* not found */ }
  }
  if (envVars.ANTHROPIC_API_KEY) {
    await setKey("anthropic", envVars.ANTHROPIC_API_KEY);
    process.env.ANTHROPIC_API_KEY = envVars.ANTHROPIC_API_KEY;
  }
  if (envVars.OPENAI_API_KEY) {
    await setKey("openai", envVars.OPENAI_API_KEY);
    process.env.OPENAI_API_KEY = envVars.OPENAI_API_KEY;
  }
  if (envVars.ELEVENLABS_API_KEY) {
    await setKey("elevenlabs", envVars.ELEVENLABS_API_KEY);
    process.env.ELEVENLABS_API_KEY = envVars.ELEVENLABS_API_KEY;
  }
  if (envVars.GOOGLE_PROJECT_ID) process.env.GOOGLE_PROJECT_ID = envVars.GOOGLE_PROJECT_ID;
  if (envVars.GOOGLE_CLIENT_EMAIL) process.env.GOOGLE_CLIENT_EMAIL = envVars.GOOGLE_CLIENT_EMAIL;
  if (envVars.GOOGLE_PRIVATE_KEY) process.env.GOOGLE_PRIVATE_KEY = envVars.GOOGLE_PRIVATE_KEY;
}

let mainWindow: BrowserWindow | null = null;
let glowWindow: BrowserWindow | null = null;
// Collapse-to-bar state: remember the expanded size while collapsed, and
// stop bounds persistence from saving the collapsed stub size.
let expandedSize: { width: number; height: number } | null = null;
let isCollapsed = false;
// Whether the renderer asked to be docked. Survives an involuntary undock
// (docked monitor unplugged) so we can redock once a watched display exists.
let wantsDock = false;
let redockTimer: ReturnType<typeof setTimeout> | null = null;
let tray: Tray | null = null;
let glowAdjusting = false;
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// Push-to-talk edge detector. Module-level so changing the bound key can reset
// it — otherwise rebinding mid-hold would latch the mic open forever.
const pttDetector = new HoldDetector();

// Manual window dragging. CSS -webkit-app-region: drag is unreliable for
// transparent frameless windows on Windows, so the renderer reports
// drag-start/end and we follow the cursor from the main process.
let dragInterval: ReturnType<typeof setInterval> | null = null;
// A real drag never lasts this long — hard stop so a missed pointerup can
// never leave the window glued to the cursor ("floating down the screen").
const DRAG_WATCHDOG_MS = 20_000;

function startWindowDrag() {
  // A docked appbar owns its position — manual dragging would tear the
  // window off the reserved strip.
  if (!mainWindow || mainWindow.isDestroyed() || dragInterval || isDocked()) return;
  const cursorStart = screen.getCursorScreenPoint();
  const [winX, winY] = mainWindow.getPosition();
  const startedAt = Date.now();
  dragInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopWindowDrag();
      return;
    }
    if (Date.now() - startedAt > DRAG_WATCHDOG_MS) {
      console.warn("[drag] watchdog stop — pointerup was never delivered");
      stopWindowDrag();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    mainWindow.setPosition(
      winX + (cursor.x - cursorStart.x),
      winY + (cursor.y - cursorStart.y),
    );
  }, 12);
}

function stopWindowDrag() {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
}

// Accent palette for the glow overlay — mirrors src/design/theme.ts ACCENTS.
const GLOW_ACCENTS: Record<string, { hex: string; rgb: string }> = {
  lime: { hex: "#8FBE2E", rgb: "143,190,46" },
  cobalt: { hex: "#4F8BF2", rgb: "79,139,242" },
  rose: { hex: "#FF6B81", rgb: "255,107,129" },
  slate: { hex: "#9FB2C8", rgb: "159,178,200" },
};

function currentGlowAccent(): { hex: string; rgb: string } {
  return GLOW_ACCENTS[loadSettings().accentColor] ?? GLOW_ACCENTS.lime;
}

// The glow overlay renders an always-visible highlighted box marking the
// capture region. In "adjust" mode the box becomes draggable/resizable so the
// user can pick exactly what gets captured (e.g. one application window).
// Colors follow the user's accent so the box visibly belongs to SightLine.
const buildGlowHtml = (accent: { hex: string; rgb: string }) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;user-select:none}
html,body{width:100vw;height:100vh;overflow:hidden;background:transparent;
font-family:system-ui,-apple-system,Segoe UI,sans-serif}
#root{position:fixed;inset:0}
#box{position:fixed;border:4px solid rgba(${accent.rgb},0.9);
box-shadow:inset 0 0 70px 20px rgba(${accent.rgb},0.28),0 0 70px 20px rgba(${accent.rgb},0.28);
animation:pulse 2.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:0.5}50%{opacity:1}}
/* click-target flash: a short glow over the element the coach wants clicked */
#flash{position:fixed;display:none;pointer-events:none;border-radius:10px;
border:4px solid ${accent.hex};
box-shadow:0 0 0 4px rgba(${accent.rgb},0.35),0 0 44px 14px rgba(${accent.rgb},0.6),inset 0 0 26px 6px rgba(${accent.rgb},0.35)}
#flash.on{display:block;animation:flashpulse 0.55s ease-in-out 3}
@keyframes flashpulse{0%,100%{opacity:0.2}50%{opacity:1}}
.handle{position:absolute;width:16px;height:16px;background:#fff;
border:2px solid rgba(${accent.rgb},1);border-radius:3px;display:none}
#toolbar{position:fixed;left:50%;top:18px;transform:translateX(-50%);
display:none;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;
background:rgba(17,17,23,0.92);border:1px solid rgba(${accent.rgb},0.5);
color:#e5e7eb;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,0.5)}
#toolbar button{font:inherit;cursor:pointer;border-radius:6px;padding:5px 10px;border:0}
#size{color:rgba(${accent.rgb},0.95);font-variant-numeric:tabular-nums;min-width:96px;text-align:center}
.btn-primary{background:${accent.hex};color:#111}
.btn-ghost{background:transparent;color:#cbd5e1;border:1px solid rgba(255,255,255,0.18)!important}
/* view mode: pure visual border, fully click-through */
#root[data-mode="view"] #box{pointer-events:none}
/* adjust mode: dim everything outside the box, show handles + toolbar */
#root[data-mode="adjust"] #box{cursor:move;animation:none;
box-shadow:0 0 0 100000px rgba(0,0,0,0.5),inset 0 0 60px 12px rgba(${accent.rgb},0.35)}
#root[data-mode="adjust"] .handle{display:block}
#root[data-mode="adjust"] #toolbar{display:flex}
.h-nw{top:-8px;left:-8px;cursor:nwse-resize}
.h-n{top:-8px;left:calc(50% - 8px);cursor:ns-resize}
.h-ne{top:-8px;right:-8px;cursor:nesw-resize}
.h-e{top:calc(50% - 8px);right:-8px;cursor:ew-resize}
.h-se{bottom:-8px;right:-8px;cursor:nwse-resize}
.h-s{bottom:-8px;left:calc(50% - 8px);cursor:ns-resize}
.h-sw{bottom:-8px;left:-8px;cursor:nesw-resize}
.h-w{top:calc(50% - 8px);left:-8px;cursor:ew-resize}
</style></head><body>
<div id="root" data-mode="view">
  <div id="box" data-handle="move">
    <div class="handle h-nw" data-handle="nw"></div>
    <div class="handle h-n" data-handle="n"></div>
    <div class="handle h-ne" data-handle="ne"></div>
    <div class="handle h-e" data-handle="e"></div>
    <div class="handle h-se" data-handle="se"></div>
    <div class="handle h-s" data-handle="s"></div>
    <div class="handle h-sw" data-handle="sw"></div>
    <div class="handle h-w" data-handle="w"></div>
  </div>
  <div id="flash"></div>
  <div id="toolbar">
    <span>Drag to set the capture area</span>
    <span id="size"></span>
    <button id="full" class="btn-ghost" type="button">Full screen</button>
    <button id="cancel" class="btn-ghost" type="button">Cancel</button>
    <button id="done" class="btn-primary" type="button">Done</button>
  </div>
</div>
<script>
(function(){
  var api = window.glowApi;
  var MIN = 80;
  var mode = "view";
  var region = null; // {x,y,width,height} | null (null = full screen)
  var root = document.getElementById("root");
  var box = document.getElementById("box");
  var sizeLabel = document.getElementById("size");

  function bounds(){ return { w: window.innerWidth, h: window.innerHeight }; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function current(){
    if (region) return region;
    var b = bounds();
    return { x:0, y:0, width:b.w, height:b.h };
  }
  function render(){
    var r = current();
    box.style.left = r.x + "px";
    box.style.top = r.y + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    root.dataset.mode = mode;
    sizeLabel.textContent = Math.round(r.width) + " × " + Math.round(r.height);
  }

  var drag = null;
  root.addEventListener("pointerdown", function(e){
    if (mode !== "adjust") return;
    var handle = e.target && e.target.dataset ? e.target.dataset.handle : null;
    if (!handle) return;
    e.preventDefault();
    region = current();
    drag = { handle: handle, sx: e.clientX, sy: e.clientY, orig: {
      x: region.x, y: region.y, width: region.width, height: region.height } };
    try { root.setPointerCapture(e.pointerId); } catch(_) {}
  });
  root.addEventListener("pointermove", function(e){
    if (!drag) return;
    var b = bounds();
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    var o = drag.orig, H = drag.handle;
    var x = o.x, y = o.y, w = o.width, h = o.height;
    var right = o.x + o.width, bottom = o.y + o.height;
    if (H === "move"){
      x = clamp(o.x + dx, 0, b.w - o.width);
      y = clamp(o.y + dy, 0, b.h - o.height);
    } else {
      if (H.indexOf("w") !== -1){ var nx = clamp(o.x + dx, 0, right - MIN); w = right - nx; x = nx; }
      if (H.indexOf("e") !== -1){ var nr = clamp(right + dx, o.x + MIN, b.w); w = nr - x; }
      if (H.indexOf("n") !== -1){ var ny = clamp(o.y + dy, 0, bottom - MIN); h = bottom - ny; y = ny; }
      if (H.indexOf("s") !== -1){ var nb = clamp(bottom + dy, o.y + MIN, b.h); h = nb - y; }
    }
    region = { x: x, y: y, width: w, height: h };
    render();
  });
  function endDrag(e){ if (drag){ drag = null; try { root.releasePointerCapture(e.pointerId); } catch(_) {} } }
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  document.getElementById("full").addEventListener("click", function(){ region = null; render(); });
  document.getElementById("done").addEventListener("click", function(){ api.commit(region); });
  document.getElementById("cancel").addEventListener("click", function(){ api.cancel(); });
  window.addEventListener("keydown", function(e){
    if (mode !== "adjust") return;
    if (e.key === "Escape") api.cancel();
    if (e.key === "Enter") api.commit(region);
  });
  window.addEventListener("resize", render);

  api.onSetMode(function(payload){
    mode = payload.mode;
    region = payload.region || null;
    render();
  });

  var flash = document.getElementById("flash");
  var flashTimer = null;
  if (api.onFlash) api.onFlash(function(r){
    flash.style.left = r.x + "px";
    flash.style.top = r.y + "px";
    flash.style.width = r.width + "px";
    flash.style.height = r.height + "px";
    flash.classList.remove("on");
    void flash.offsetWidth; /* restart the CSS animation */
    flash.classList.add("on");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function(){ flash.classList.remove("on"); }, 1800);
  });
  render();
})();
</script>
</body></html>`;

function getGlowDisplay(displayId: string | null) {
  const all = screen.getAllDisplays();
  return (
    (displayId ? all.find((d) => String(d.id) === displayId) : null) ??
    screen.getPrimaryDisplay()
  );
}

// The glow window's top-left relative to the display it sits on. Zero when
// floating; the dock strip's width (or zero) when docked, because the glow
// then covers only the remainder of the display.
function glowOffsetOnDisplay(): { x: number; y: number } {
  if (!glowWindow || glowWindow.isDestroyed()) return { x: 0, y: 0 };
  const gb = glowWindow.getBounds();
  const display = screen.getDisplayMatching(gb);
  return { x: gb.x - display.bounds.x, y: gb.y - display.bounds.y };
}

function broadcastGlowMode() {
  if (!glowWindow || glowWindow.isDestroyed()) return;
  // The stored region is display-relative; the glow renders in its own
  // window's coordinates, which may start at the dock strip's edge.
  const stored = loadSettings().captureRegion ?? null;
  let region: CaptureRegion | null = null;
  if (stored) {
    const off = glowOffsetOnDisplay();
    const gb = glowWindow.getBounds();
    const x = Math.max(0, stored.x - off.x);
    const y = Math.max(0, stored.y - off.y);
    const right = Math.min(gb.width, stored.x + stored.width - off.x);
    const bottom = Math.min(gb.height, stored.y + stored.height - off.y);
    if (right - x >= 1 && bottom - y >= 1) {
      region = { x, y, width: right - x, height: bottom - y };
    }
  }
  glowWindow.webContents.send("glow:set-mode", {
    mode: glowAdjusting ? "adjust" : "view",
    region,
  });
}

function showGlowOverlay(displayId: string | null) {
  // destroy(), not close(): close() is asynchronous, so the old overlay was
  // still alive while the new one was created. Its 'closed' handler then fired
  // LATER and unconditionally nulled `glowWindow` — which by then pointed at
  // the NEW overlay. The next call saw null, skipped the teardown, and created
  // another window, leaving the previous one stranded on the old monitor.
  // That's the green box that stayed behind when switching screens.
  if (glowWindow && !glowWindow.isDestroyed()) {
    glowWindow.destroy();
  }
  glowWindow = null;
  glowAdjusting = false;

  const target = getGlowDisplay(displayId);
  // While docked on this display the glow outlines the remaining desktop —
  // the sidebar's strip is excluded from capture, so it's excluded from the
  // "what I'm watching" box too.
  const dock = getDockRectDip();
  const area =
    dock && dock.displayId === String(target.id)
      ? subtractDockStrip(target.bounds, dock.rect)
      : target.bounds;
  const { x, y, width, height } = area;

  glowWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "glow-preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  glowWindow.setIgnoreMouseEvents(true, { forward: true });
  glowWindow.setAlwaysOnTop(true, "screen-saver");
  glowWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  glowWindow.webContents.on("did-finish-load", () => broadcastGlowMode());

  void glowWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildGlowHtml(currentGlowAccent()))}`,
  );

  // Only clear the shared reference if it still points at THIS window. Without
  // the identity check, a late 'closed' event from a superseded overlay wipes
  // the pointer to the current one and strands it on screen.
  const thisWindow = glowWindow;
  glowWindow.on("closed", () => {
    if (glowWindow === thisWindow) glowWindow = null;
  });
}

// The display id the glow should sit on = the display of the screen that is
// ACTUALLY captured. Pinned source wins (via pixel-verified calibration);
// stored displayId and primary are fallbacks.
async function resolveWatchedDisplayId(): Promise<string | null> {
  const s = loadSettings();
  try {
    const cal = await getCalibration();
    if (s.selectedSourceId) {
      const d = cal.sourceToDisplay.get(s.selectedSourceId);
      if (d) return d;
    }
    if (s.selectedSourceName) {
      const d = cal.nameToDisplay.get(s.selectedSourceName);
      if (d) return d;
    }
  } catch (err) {
    console.warn("[glow] calibration unavailable, using stored display:", err);
  }
  if (s.selectedDisplayId) return s.selectedDisplayId;
  return String(screen.getPrimaryDisplay().id);
}

// The floating window's collapse-to-bar shapes. Shared by the IPC handler and
// the dock path, which has to expand a collapsed capsule before docking —
// otherwise dock.ts snapshots the 380x56 stub as the "floating bounds" and a
// later undock restores the full UI into it.
const COLLAPSED_BAR = { width: 380, height: 56 };
const FLOATING_MIN = { width: 460, height: 380 };

function collapseFloating(): void {
  if (!mainWindow || mainWindow.isDestroyed() || isCollapsed) return;
  const b = mainWindow.getBounds();
  expandedSize = { width: b.width, height: b.height };
  isCollapsed = true;
  // Must shrink the minimum before setBounds — the normal minHeight would
  // block the bar height.
  mainWindow.setMinimumSize(300, 48);
  mainWindow.setBounds({ x: b.x, y: b.y, ...COLLAPSED_BAR });
  mainWindow.setResizable(false);
}

function expandFloating(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isCollapsed) return;
  const b = mainWindow.getBounds();
  isCollapsed = false;
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(FLOATING_MIN.width, FLOATING_MIN.height);
  // Expand where the bar currently sits.
  mainWindow.setBounds({
    x: b.x,
    y: b.y,
    width: expandedSize?.width ?? 540,
    height: expandedSize?.height ?? 720,
  });
}

// Dock the panel to the watched monitor — the one actually captured — so the
// coach sits beside the work it's coaching through.
async function dockToWatchedDisplay(): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const s = loadSettings();
  const watchedId = await resolveWatchedDisplayId();
  const display =
    screen.getAllDisplays().find((d) => String(d.id) === watchedId) ??
    screen.getPrimaryDisplay();
  // A collapsed floating capsule must expand before docking (see above). The
  // strip then starts at the rail width so the collapsed state carries over.
  const wasCollapsed = isCollapsed && !isDocked();
  if (wasCollapsed) expandFloating();
  const ok = dockWindow(
    mainWindow,
    display,
    s.dockSide,
    wasCollapsed ? RAIL_WIDTH : clampDockWidth(s.dockWidth),
  );
  if (ok) {
    isCollapsed = wasCollapsed;
    mainWindow.setOpacity(1);
  }
  return ok;
}

function hideGlowOverlay() {
  if (glowWindow && !glowWindow.isDestroyed()) {
    glowWindow.destroy();
  }
  glowWindow = null;
  glowAdjusting = false;
}

async function setGlowAdjust(adjust: boolean) {
  if (!glowWindow || glowWindow.isDestroyed()) {
    showGlowOverlay(await resolveWatchedDisplayId());
  }
  if (!glowWindow) return;
  glowAdjusting = adjust;
  if (adjust) {
    glowWindow.setIgnoreMouseEvents(false);
    glowWindow.setFocusable(true);
    glowWindow.focus();
  } else {
    glowWindow.setIgnoreMouseEvents(true, { forward: true });
    glowWindow.setFocusable(false);
  }
  broadcastGlowMode();
}

// Convert the region the user drew in the glow window into DISPLAY-relative
// coordinates, clamp it to the display, and treat a selection covering the
// whole glow area as "no region" so capture falls back to the full desktop.
//
// Display-relative is the only stable frame: the glow window covers just the
// remainder of the display while docked, so a region stored in ITS
// coordinates silently moved every time the dock width changed or the panel
// undocked — the model ended up looking at the wrong part of the screen.
function normalizeRegion(
  region: { x: number; y: number; width: number; height: number } | null,
  displayId: string | null,
): CaptureRegion | null {
  if (!region) return null;
  const display = getGlowDisplay(displayId);
  const { width: dw, height: dh } = display.size;
  const gb =
    glowWindow && !glowWindow.isDestroyed()
      ? glowWindow.getBounds()
      : { x: display.bounds.x, y: display.bounds.y, width: dw, height: dh };
  const coversGlow =
    region.x <= 2 &&
    region.y <= 2 &&
    region.width >= gb.width - 4 &&
    region.height >= gb.height - 4;
  if (coversGlow) return null;
  const off = { x: gb.x - display.bounds.x, y: gb.y - display.bounds.y };
  const x = Math.max(0, Math.min(region.x + off.x, dw));
  const y = Math.max(0, Math.min(region.y + off.y, dh));
  const width = Math.max(1, Math.min(region.width, dw - x));
  const height = Math.max(1, Math.min(region.height, dh - y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function createWindow() {
  const settings = loadSettings();
  const saved = settings.windowBounds;

  mainWindow = new BrowserWindow({
    width:  saved?.width  ?? 540,
    height: saved?.height ?? 720,
    x:      saved?.x,
    y:      saved?.y,
    minWidth: 460,
    minHeight: 380,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    title: "SightLine",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setOpacity(settings.opacity);

  // Save position/size whenever the user moves or resizes the window.
  // Debounced — manual dragging emits "moved" continuously — and skipped
  // while collapsed so the bar's stub size never gets persisted.
  let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null;
      // Skip the collapsed stub and the docked strip — neither is a real
      // floating size, and persisting them would clobber the saved bounds.
      if (isCollapsed || isDocked()) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveSettings({ windowBounds: mainWindow.getBounds() });
      }
    }, 400);
  };
  mainWindow.on("moved", saveBounds);
  mainWindow.on("resized", saveBounds);

  // Renderer errors used to vanish into a console nobody has open — a React
  // crash showed up as a blank panel with no trace anywhere. Route warnings
  // and errors into the same diagnostic log as everything else.
  mainWindow.webContents.on("console-message", (event) => {
    // Electron 4x+ passes a single event object; `level` is a string here.
    const { level, message, lineNumber, sourceId } = event;
    if (level !== "warning" && level !== "error") return; // debug/info is noise
    const where = sourceId ? ` (${path.basename(sourceId)}:${lineNumber})` : "";
    logLine(`[renderer:${level}] ${message}${where}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    logLine(`[renderer] process gone: ${details.reason} (exit ${details.exitCode})`);
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logLine(`[renderer] failed to load ${url}: ${desc} (${code})`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    logLine("[renderer] became unresponsive");
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Minimize undocks (a minimized appbar would leave a dead reserved strip).
  // Coming back should put the sidebar back — until this handler existed,
  // one minimize left the app floating for the rest of the run.
  mainWindow.on("restore", () => {
    if (wantsDock && !isDocked()) void dockToWatchedDisplay();
  });

  mainWindow.on("closed", () => {
    hideGlowOverlay();
    stopWindowDrag();
    try {
      uIOhook.stop();
    } catch {
      // never started
    }
    if (inputDebounceTimer) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  logLine(`[app] SightLine starting (v${app.getVersion()}, log at ${getLogPath() ?? "unavailable"})`);
  await loadKeysFromEnv();

  // One-time migration: settings saved before the opaque-by-default change
  // get forced to a fully opaque window once; the Settings sliders remain
  // as the opt-out afterwards.
  if (!loadSettings().uiOpaqueMigration) {
    saveSettings({ opacity: 1, solidBackground: true, uiOpaqueMigration: true });
    console.log("[settings] applied one-time opaque-UI migration");
  }

  // One-time migration: the side-rail layout needs more horizontal room, so
  // widen any saved window that's narrower than the new minimum just once.
  if (!loadSettings().uiSideRailMigration) {
    const wb = loadSettings().windowBounds;
    saveSettings({
      windowBounds: wb ? { ...wb, width: Math.max(540, wb.width) } : null,
      uiSideRailMigration: true,
    });
    console.log("[settings] applied one-time side-rail width migration");
  }

  // One-time migration: capture regions used to be stored relative to the
  // glow window (the desktop minus the dock strip), which moved with the dock.
  // They are display-relative now; an old value can't be converted without
  // knowing the dock state it was drawn in, so it is cleared once.
  if (!loadSettings().captureRegionDisplayRelative) {
    saveSettings({ captureRegion: null, captureRegionDisplayRelative: true });
    console.log("[settings] applied one-time capture-region migration");
  }

  registerIpc();
  createWindow();

  // Dock transitions (including involuntary ones — docked monitor unplugged,
  // width changes) fan out to the renderer chrome and the glow overlay.
  let glowRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  setDockChangeListener(({ docked, rect, displayLost }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dock:changed", { docked, rect });
    }
    // Recreating the glow window is heavy — debounce so a live drag-resize
    // refreshes it once at the end, not per frame.
    if (glowRefreshTimer) clearTimeout(glowRefreshTimer);
    glowRefreshTimer = setTimeout(() => {
      glowRefreshTimer = null;
      void resolveWatchedDisplayId().then((id) => {
        if (glowWindow && !glowWindow.isDestroyed()) showGlowOverlay(id);
      });
    }, 300);
    if (displayLost && wantsDock) {
      // Redock once the display set settles and recalibration has re-resolved
      // the watched screen.
      if (redockTimer) clearTimeout(redockTimer);
      redockTimer = setTimeout(() => {
        redockTimer = null;
        if (wantsDock && !isDocked()) void dockToWatchedDisplay();
      }, 2_500);
    }
  });

  // Pixel-verified screen calibration: runs now (before the first capture)
  // and re-runs when monitors change; each fresh result re-places the glow on
  // the display that is ACTUALLY captured.
  initCalibration(() => {
    void resolveWatchedDisplayId().then((id) => {
      if (glowWindow && !glowWindow.isDestroyed()) showGlowOverlay(id);
      // If we're docked but calibration just re-identified the watched screen
      // as a different monitor, follow it (display_id lies on this machine —
      // this is how the sidebar lands on the RIGHT monitor after the initial
      // dock to primary).
      if (wantsDock && isDocked() && getDockRectDip()?.displayId !== id) {
        void dockToWatchedDisplay();
      }
    });
  });

  // Coach Mode: the docked sidebar is the default view — reserve the strip as
  // soon as the app is up, not just during sessions. Falls back to a floating
  // window automatically if the AppBar layer is unavailable.
  if (loadSettings().dockEnabled) {
    wantsDock = true;
    void dockToWatchedDisplay();
  }

  // The capture-region glow is always visible while the app is running so the
  // user can see exactly what's being captured at any time.
  void resolveWatchedDisplayId().then((id) => {
    showGlowOverlay(id);
    void setGlowAdjust(false); // safety: never stuck in interactive mode from a prior session
  });

  // Pre-synthesize the coach's fixed phrases (thinking fillers, wrap-ups) so
  // the first one of the session plays instantly. Unawaited — launch must not
  // wait on the speech provider, and a failure here is silently harmless.
  void warmPhraseCache();

  // Global input listener — debounced so rapid typing/clicking doesn't spam ticks
  function scheduleInputTick() {
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      mainWindow?.webContents.send("input:activity");
      inputDebounceTimer = null;
    }, 750);
  }
  uIOhook.on("click", scheduleInputTick);
  uIOhook.on("keyup", scheduleInputTick);

  // Hold-to-talk. Watched globally because the user is looking at the app
  // being coached, not at SightLine — a focus-scoped shortcut would never
  // fire. The detector collapses OS auto-repeat down to one press edge.
  // (These run on every system-wide keystroke; loadSettings is served from
  // memory, so this is a map lookup, not a disk read.)
  uIOhook.on("keydown", (e) => {
    const key = loadSettings().pushToTalkKey;
    if (pttDetector.keyDown(isPushToTalkCode(key, e.keycode)) === "press") {
      mainWindow?.webContents.send("voice:ptt", { down: true });
    }
  });
  uIOhook.on("keyup", (e) => {
    const key = loadSettings().pushToTalkKey;
    if (pttDetector.keyUp(isPushToTalkCode(key, e.keycode)) === "release") {
      mainWindow?.webContents.send("voice:ptt", { down: false });
    }
  });
  // Safety net for manual dragging: if the renderer's pointerup is ever
  // missed, the global mouse-up still ends the drag.
  uIOhook.on("mouseup", stopWindowDrag);
  try {
    uIOhook.start();
  } catch (err) {
    // The native hook failing to load must not take the rest of startup
    // with it. The app still works — without the input trigger and
    // push-to-talk — and the log says why.
    logLine(
      `[input] global input hook failed to start (input trigger + push-to-talk disabled): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // System tray — always-available quit fallback regardless of which view is open.
  const trayIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip("SightLine");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show SightLine", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Quit SightLine", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => mainWindow?.show());

  // Ctrl+Q is handled by the renderer while SightLine has focus. It used to
  // be a GLOBAL shortcut, which quit the coach — mid-session, without the
  // in-app confirmation — whenever the user pressed Ctrl+Q in the program
  // they were being coached in, and stole the key from that program.

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err: unknown) => {
  logLine(`[app] startup failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Never leave reserved desktop space behind — release the appbar strip on
// the way out (dock.ts also handles window close; the OS handles a crash).
app.on("will-quit", () => {
  undockWindow();
});

function registerIpc() {
  ipcMain.handle("settings:get", () => loadSettings());

  ipcMain.handle(
    "settings:set",
    (_e: IpcMainInvokeEvent, patch: Record<string, unknown>) => {
      const prev = loadSettings();
      // Switching screens invalidates any saved capture region — the region
      // is in display-relative coordinates, so keeping it would silently crop
      // a nonsense rectangle out of the new screen.
      const screenChanged =
        ("selectedDisplayId" in patch &&
          patch.selectedDisplayId !== prev.selectedDisplayId) ||
        ("selectedSourceId" in patch &&
          patch.selectedSourceId !== prev.selectedSourceId);
      if (screenChanged && !("captureRegion" in patch)) {
        patch = { ...patch, captureRegion: null };
      }
      const next = saveSettings(patch);
      if (mainWindow && typeof patch.opacity === "number" && !isDocked()) {
        mainWindow.setOpacity(next.opacity);
      }
      // Rebinding push-to-talk while the old key is held would otherwise leave
      // the detector latched down and the mic open with no way to release it.
      if ("pushToTalkKey" in patch && next.pushToTalkKey !== prev.pushToTalkKey) {
        if (pttDetector.isDown()) {
          pttDetector.reset();
          mainWindow?.webContents.send("voice:ptt", { down: false });
        }
      }
      // Toggling "dock to the side" from Settings docks/undocks live so the
      // change is visible immediately, not on next launch.
      if ("dockEnabled" in patch && next.dockEnabled !== prev.dockEnabled) {
        wantsDock = next.dockEnabled;
        if (next.dockEnabled) {
          void dockToWatchedDisplay();
        } else {
          undockWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setOpacity(next.opacity);
          }
        }
      } else if ("dockSide" in patch && patch.dockSide !== prev.dockSide && isDocked()) {
        // Re-dock on the other edge.
        void dockToWatchedDisplay();
      } else if (screenChanged && isDocked()) {
        // The coach must sit beside the work it's watching — when the user
        // switches monitors, move the docked strip to the new screen.
        void dockToWatchedDisplay();
      }
      // Moving the capture to a different screen (or recoloring the accent)
      // means the glow overlay has to be recreated.
      const accentChanged =
        "accentColor" in patch && next.accentColor !== prev.accentColor;
      if (screenChanged || accentChanged) {
        void resolveWatchedDisplayId().then(showGlowOverlay);
      } else if ("captureRegion" in patch) {
        // Region changed elsewhere (e.g. "Reset to full screen") — refresh the
        // glow so the visible box matches what's actually captured.
        broadcastGlowMode();
      }
      return next;
    },
  );

  ipcMain.handle("keys:get-status", async () => ({
    anthropic: await hasKey("anthropic"),
    openai: await hasKey("openai"),
    google: hasGoogleCredentials(),
    elevenlabs: hasElevenLabsKey() || (await hasKey("elevenlabs")),
  }));

  ipcMain.handle("capture:list-targets", () => listCaptureTargets());

  ipcMain.handle("capture:recalibrate", async () => {
    invalidateCalibration();
    let complete = false;
    try {
      const result = await getCalibration(true);
      complete = result.complete;
    } catch (err) {
      console.warn("[calibrate] manual recalibration failed:", err);
    }
    void resolveWatchedDisplayId().then((id) => {
      if (glowWindow && !glowWindow.isDestroyed()) showGlowOverlay(id);
    });
    return { complete };
  });

  ipcMain.handle(
    "capture:once",
    async (_e: IpcMainInvokeEvent, payload: { displayId: string | null }) => {
      const settings = loadSettings();
      return await captureFrame(
        {
          displayId: payload.displayId ?? null,
          sourceId: settings.selectedSourceId,
          sourceName: settings.selectedSourceName,
        },
        settings.captureRegion ?? null,
      );
    },
  );

  ipcMain.handle("files:pick-context", async (): Promise<UploadedContext[]> => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Attach context",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Text & Markdown", extensions: ["txt", "md", "markdown", "text"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    const MAX_BYTES = 200_000;
    const files: UploadedContext[] = [];
    for (const filePath of result.filePaths) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const text = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
        files.push({ name: path.basename(filePath), text });
      } catch (err) {
        console.error("[files] failed to read", filePath, err);
      }
    }
    return files;
  });

  ipcMain.handle(
    "claude:next-instruction",
    async (e: IpcMainInvokeEvent, args: NextInstructionArgs) => {
      const startedAt = Date.now();
      try {
        const result = await getNextInstruction(
          args,
          (chunk) => {
            if (!e.sender.isDestroyed()) {
              e.sender.send("claude:speech-chunk", chunk);
            }
          },
          {
            // The agent's zoom lens. Re-captures at near-native resolution
            // and crops, so small on-screen text becomes readable. Geometry
            // recording is off: the glow overlay maps highlight fractions
            // against the last recorded rect, and a zoomed read must not
            // become that reference.
            async captureRegion(rect) {
              const settings = loadSettings();
              try {
                return await captureFrame(
                  {
                    displayId: settings.selectedDisplayId ?? null,
                    sourceId: settings.selectedSourceId,
                    sourceName: settings.selectedSourceName,
                  },
                  settings.captureRegion ?? null,
                  { zoom: rect, recordGeometry: false },
                );
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logLine(`[agent] read_screen_region capture failed: ${msg}`);
                return null;
              }
            },
            log: logLine,
          },
        );
        logLine(
          `[claude] action=${result.action} in ${Date.now() - startedAt}ms ` +
            `digression=${result.digression} needsResearch=${result.needsResearch} ` +
            `steps=${result.completedSteps.length} highlight=${result.highlight ? "yes" : "no"}` +
            (result.toolsUsed?.length
              ? ` tools=[${result.toolsUsed.join(",")}]`
              : ""),
        );
        return result;
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          logLine("[claude] FAILED: missing API key");
          return { __error: "missing_api_key" } as const;
        }
        if (err instanceof RateLimitError) {
          logLine(`[claude] rate limited, retry after ${err.retryAfterSec}s`);
          return {
            __error: "rate_limited",
            retryAfterSec: err.retryAfterSec,
          } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        logLine(`[claude] FAILED after ${Date.now() - startedAt}ms: ${msg}`);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  // The renderer asks the agent how it wants to be ticked. The agent owns the
  // cadence; the renderer owns the scheduler, because ticking needs the frame
  // hash, the TTS queue, and the session store — all renderer-side.
  ipcMain.handle(
    "agent:describe",
    (_e: IpcMainInvokeEvent, payload: { mode: AppMode }) => {
      const descriptor = describeAgent(payload.mode);
      logLine(
        `[agent] describe ${descriptor.id}: poll=${descriptor.loop.normalIntervalMs}ms ` +
          `spacing=${descriptor.loop.minCallSpacingMs}ms quiet=${descriptor.loop.quietPeriodMs}ms ` +
          `stall=${descriptor.loop.stallEnabled} skills=[${descriptor.skills.join(",")}] ` +
          `tools=[${descriptor.tools.join(",")}]`,
      );
      return descriptor;
    },
  );

  ipcMain.handle(
    "claude:get-clarifications",
    async (_e: IpcMainInvokeEvent, args: { mode: AppMode; goal: string }) => {
      try {
        return await getClarifications(args);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          return { __error: "missing_api_key" } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "claude:get-session-plan",
    async (
      _e: IpcMainInvokeEvent,
      args: {
        mode: AppMode;
        goal: string;
        clarifications: Clarification[];
        screenshot?: string;
      },
    ) => {
      try {
        return await getSessionPlan(args);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          return { __error: "missing_api_key" } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "whisper:transcribe",
    async (
      _e: IpcMainInvokeEvent,
      args: { audioBase64: string; mimeType: string },
    ) => {
      try {
        const text = await transcribe(args);
        return { text };
      } catch (err) {
        if (err instanceof MissingOpenAIKeyError) {
          return { __error: "missing_openai_key" } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "window:set-opacity",
    (_e: IpcMainInvokeEvent, payload: { opacity: number }) => {
      if (!mainWindow) return;
      // Docked: a translucent appbar reads as broken chrome — stay opaque.
      const clamped = isDocked()
        ? 1
        : Math.max(0.25, Math.min(1, payload.opacity));
      mainWindow.setOpacity(clamped);
    },
  );

  ipcMain.handle(
    "window:set-collapsed",
    (_e: IpcMainInvokeEvent, payload: { collapsed: boolean }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Docked: collapse shrinks the reserved strip to a thin rail instead
      // of the floating capsule — the session keeps running, the desktop
      // gets its width back. `isCollapsed` is kept in step so an undock
      // later knows which floating shape to restore (this used to desync
      // and leave the full UI crammed into the 380x56 collapsed stub).
      if (isDocked()) {
        isCollapsed = payload.collapsed;
        updateDockWidth(
          payload.collapsed
            ? RAIL_WIDTH
            : clampDockWidth(loadSettings().dockWidth),
        );
        return;
      }
      if (payload.collapsed) collapseFloating();
      else expandFloating();
    },
  );

  ipcMain.handle(
    "window:open-external",
    async (_e: IpcMainInvokeEvent, payload: { url: string }) => {
      if (!/^https?:\/\//i.test(payload.url)) return;
      await shell.openExternal(payload.url);
    },
  );

  ipcMain.handle("app:quit", () => {
    app.quit();
  });

  ipcMain.on("window:drag-start", () => startWindowDrag());
  ipcMain.on("window:drag-end", () => stopWindowDrag());

  ipcMain.handle("window:minimize", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // A minimized appbar would leave a dead reserved strip — undock first.
    // `wantsDock` is left alone so the "restore" handler can redock.
    if (isDocked()) undockWindow();
    mainWindow.minimize();
  });

  ipcMain.handle(
    "research:search",
    async (_e: IpcMainInvokeEvent, payload: { query: string }) => {
      // Real web search first (Claude's server-side web_search tool — the
      // same one the session planner uses). The legacy DuckDuckGo
      // instant-answer lookup remains only as a fallback: it returns empty
      // for most real queries, but empty is still better than an error.
      const startedAt = Date.now();
      try {
        const text = await withTimeout(
          runWebResearch(payload.query),
          45_000,
          "research_timeout",
        );
        logLine(
          `[research] web search ok in ${Date.now() - startedAt}ms (${text.length} chars) for "${payload.query.slice(0, 80)}"`,
        );
        return { text };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logLine(`[research] web search failed (${msg}); trying DuckDuckGo fallback`);
      }
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(payload.query)}&format=json&no_html=1&skip_disambig=1`;
        const resp = await fetch(url, { headers: { "User-Agent": "SightLine/0.1.0" } });
        const data = await resp.json() as {
          AbstractText?: string;
          Answer?: string;
          RelatedTopics?: Array<{ Text?: string } | { Topics?: unknown[] }>;
        };
        const parts: string[] = [];
        if (data.Answer) parts.push(data.Answer);
        if (data.AbstractText) parts.push(data.AbstractText);
        if (Array.isArray(data.RelatedTopics)) {
          for (const t of data.RelatedTopics.slice(0, 5)) {
            if ("Text" in t && t.Text) parts.push(t.Text);
          }
        }
        logLine(`[research] DuckDuckGo fallback returned ${parts.length} snippet(s)`);
        return { text: parts.join("\n\n") };
      } catch (err) {
        return { __error: "fetch_failed", message: String(err) };
      }
    },
  );

  // Speech synthesis. The whole provider chain, cache, timeouts, and fallback
  // policy live in ./tts — this handler is just the IPC surface.
  ipcMain.handle(
    "tts:speak",
    async (
      _e: IpcMainInvokeEvent,
      payload: { text: string; previousText?: string },
    ) => {
      // previousText is the request-stitching context (what this response
      // already said). It was being dropped here, which made every sentence
      // after the first start a fresh performance — the wandering intonation
      // the voice settings were tuned to fix.
      const result = await synthesizeSpeech(payload.text, payload.previousText ?? "");
      if ("__error" in result) return result;
      logLine(
        `[tts] ${result.engine}${result.cached ? " (cached)" : ""} ${result.ms}ms ` +
          `for "${payload.text.slice(0, 40)}"`,
      );
      return result;
    },
  );

  ipcMain.handle("tts:list-voices", () => listElevenVoices());

  ipcMain.handle(
    "overlay:set-adjust",
    (_e: IpcMainInvokeEvent, payload: { adjust: boolean }) =>
      setGlowAdjust(Boolean(payload.adjust)),
  );

  ipcMain.handle(
    "overlay:commit-region",
    async (
      _e: IpcMainInvokeEvent,
      payload: {
        region: { x: number; y: number; width: number; height: number } | null;
      },
    ) => {
      const region = normalizeRegion(
        payload.region,
        await resolveWatchedDisplayId(),
      );
      saveSettings({ captureRegion: region });
      await setGlowAdjust(false);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("overlay:region-updated", region);
      }
    },
  );

  ipcMain.handle("overlay:cancel-adjust", () => setGlowAdjust(false));

  ipcMain.on("session:log", (_e, message: string) => {
    logLine(`[renderer] ${message}`);
  });

  // Open the diagnostic log in Explorer so the user can find/share it.
  ipcMain.handle("logs:open", () => {
    const p = getLogPath();
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
    else if (p) shell.openPath(path.dirname(p));
  });

  // Flash a glow box over the on-screen element the coach referred to.
  // Coordinates arrive as fractions of the latest captured frame; the last
  // capture's geometry maps them back to the physical display.
  ipcMain.handle(
    "overlay:flash-highlight",
    (_e: IpcMainInvokeEvent, payload: { x: number; y: number; w: number; h: number }) => {
      const geo = getLastCaptureGeometry();
      if (!geo) return;
      if (!glowWindow || glowWindow.isDestroyed()) return;
      const display = screen
        .getAllDisplays()
        .find((d) => String(d.id) === geo.displayId);
      if (!display) return;
      const PAD = 6; // breathing room so the glow doesn't sit on the element's edge
      const gb = glowWindow.getBounds();
      const rect = {
        x: Math.round(display.bounds.x + geo.rect.x + payload.x * geo.rect.width - gb.x) - PAD,
        y: Math.round(display.bounds.y + geo.rect.y + payload.y * geo.rect.height - gb.y) - PAD,
        width: Math.round(payload.w * geo.rect.width) + PAD * 2,
        height: Math.round(payload.h * geo.rect.height) + PAD * 2,
      };
      logLine(
        `[glow] flash highlight frac=(${payload.x.toFixed(2)},${payload.y.toFixed(2)},${payload.w.toFixed(2)},${payload.h.toFixed(2)}) → rect=(${rect.x},${rect.y},${rect.width},${rect.height})`,
      );
      glowWindow.webContents.send("glow:flash", rect);
    },
  );

  ipcMain.handle("dock:set", async (_e, payload: { docked: boolean }) => {
    wantsDock = Boolean(payload.docked);
    if (redockTimer) {
      clearTimeout(redockTimer);
      redockTimer = null;
    }
    if (wantsDock) {
      await dockToWatchedDisplay();
    } else {
      undockWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(loadSettings().opacity);
      }
    }
    return {
      docked: isDocked(),
      rect: getDockRectDip()?.rect ?? null,
      available: isDockingAvailable(),
    };
  });

  // Live drag-resize fires many times per second. Every width change is an
  // AppBar SETPOS, and SETPOS makes Windows broadcast a work-area change that
  // every maximized window on that monitor re-lays-out for — so the strip is
  // re-asserted at most every 50 ms (trailing edge keeps the final width),
  // and the setting is persisted debounced.
  const DOCK_RESIZE_THROTTLE_MS = 50;
  let dockWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let dockResizeTimer: ReturnType<typeof setTimeout> | null = null;
  let dockResizeLastAt = 0;
  let dockResizePending: number | null = null;
  const applyDockWidth = (width: number) => {
    dockResizeLastAt = Date.now();
    dockResizePending = null;
    if (isDocked()) updateDockWidth(width);
  };
  ipcMain.handle("dock:resize", (_e, payload: { width: number }) => {
    const width = clampDockWidth(payload.width);
    const sinceLast = Date.now() - dockResizeLastAt;
    if (sinceLast >= DOCK_RESIZE_THROTTLE_MS && dockResizeTimer === null) {
      applyDockWidth(width);
    } else {
      dockResizePending = width;
      if (dockResizeTimer === null) {
        dockResizeTimer = setTimeout(() => {
          dockResizeTimer = null;
          if (dockResizePending !== null) applyDockWidth(dockResizePending);
        }, Math.max(0, DOCK_RESIZE_THROTTLE_MS - sinceLast));
      }
    }
    if (dockWidthSaveTimer) clearTimeout(dockWidthSaveTimer);
    dockWidthSaveTimer = setTimeout(() => {
      dockWidthSaveTimer = null;
      saveSettings({ dockWidth: width });
    }, 400);
    return width;
  });

  ipcMain.handle("dock:state", () => ({
    docked: isDocked(),
    rect: getDockRectDip()?.rect ?? null,
  }));

  // ── History, memory, and saved plans ──
  // The store is the seam for the eventual move to Neon: these handlers hold
  // no persistence logic of their own, only the shapes the renderer needs.

  ipcMain.handle("history:list", () => listSessions());

  ipcMain.handle("history:get", (_e, payload: { id: string }) =>
    getSession(payload.id),
  );

  ipcMain.handle("history:save", (_e, record: SessionRecord) => {
    if (!loadSettings().historyEnabled) return { saved: false };
    const saved = saveSession(record);
    if (saved) {
      logLine(
        `[history] saved session ${record.id} (${record.mode}, ${record.turns.length} turns, ` +
          `${record.steps.filter((s) => s.state === "completed").length} steps done, ` +
          `$${record.costUsd.toFixed(4)})`,
      );
    }
    return { saved };
  });

  ipcMain.handle("history:delete", (_e, payload: { id: string }) => ({
    deleted: deleteSession(payload.id),
  }));

  // Recall: rank what we know against this goal and return both the prompt
  // text and the ids, so the renderer can show the user what was recalled.
  ipcMain.handle("memory:recall", (_e, payload: { goal: string }) => {
    if (!loadSettings().memoryEnabled) return { text: "", facts: [] };
    const now = Date.now();
    const selected = selectFacts(listFacts(), payload.goal, now);
    touchFacts(
      selected.map((f) => f.id),
      now,
    );
    logLine(
      `[memory] recalled ${selected.length} fact(s) for "${payload.goal.slice(0, 60)}"`,
    );
    return { text: formatFactsForPrompt(selected), facts: selected };
  });

  ipcMain.handle(
    "memory:add",
    (
      _e,
      payload: { kind: MemoryKind; content: string; sessionId: string | null },
    ) => {
      if (!loadSettings().memoryEnabled) return { added: false };
      const existing = listFacts();
      // The agent re-notices the same fact across turns and sessions; storing
      // each phrasing separately would crowd out everything else.
      if (isDuplicateFact(payload.content, existing)) {
        return { added: false, reason: "duplicate" as const };
      }
      const now = Date.now();
      const fact: MemoryFact = {
        id: newId("fact"),
        userId: null,
        kind: payload.kind,
        content: payload.content,
        sourceSessionId: payload.sessionId,
        createdAt: now,
        lastUsedAt: now,
        useCount: 0,
        archived: false,
      };
      addFact(fact);
      logLine(`[memory] learned (${fact.kind}): ${fact.content}`);
      return { added: true, fact };
    },
  );

  ipcMain.handle("memory:list", () =>
    listFacts().filter((f) => !f.archived),
  );

  ipcMain.handle("memory:forget", (_e, payload: { id: string }) => ({
    forgotten: forgetFact(payload.id),
  }));

  ipcMain.handle("plans:list", () => listPlans());

  ipcMain.handle("plans:save", (_e, plan: TrainingPlan) => ({
    saved: savePlan(plan),
  }));

  ipcMain.handle("plans:delete", (_e, payload: { id: string }) => ({
    deleted: deletePlan(payload.id),
  }));

  ipcMain.handle(
    "plans:save-frame",
    (_e, payload: { planId: string; frameId: string; dataUrl: string }) => ({
      // Strip the data-URL prefix; the store writes raw JPEG bytes.
      file: savePlanFrame(
        payload.planId,
        payload.frameId,
        payload.dataUrl.replace(/^data:image\/\w+;base64,/, ""),
      ),
    }),
  );

  ipcMain.handle(
    "plans:load-frame",
    (_e, payload: { planId: string; frameFile: string }) => {
      const base64 = loadPlanFrame(payload.planId, payload.frameFile);
      return { dataUrl: base64 ? `data:image/jpeg;base64,${base64}` : null };
    },
  );

  ipcMain.handle(
    "claude:curriculum-outline",
    async (
      _e: IpcMainInvokeEvent,
      args: { goal: string; clarifications: Clarification[]; screenshot?: string },
    ) => {
      try {
        return await getCurriculumOutline(args);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          return { __error: "missing_api_key" } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "claude:detail-module",
    async (
      _e: IpcMainInvokeEvent,
      args: { plan: TrainingPlan; moduleIndex: number },
    ) => {
      try {
        return await detailTrainingModule(args);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          return { __error: "missing_api_key" } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "claude:evaluate-goal",
    async (
      _e: IpcMainInvokeEvent,
      payload: {
        mode: AppMode;
        goal: string;
        completedSteps: string[];
        conversation: ConversationTurn[];
        frames: CaptureFrame[];
      },
    ) => {
      try {
        return await getGoalEvaluation(payload);
      } catch (err) {
        if (err instanceof MissingApiKeyError) return { __error: "missing_api_key" };
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg };
      }
    },
  );
}
