import { contextBridge, ipcRenderer } from "electron";
import type { CaptureRegion } from "./types";

export interface GlowMode {
  mode: "view" | "adjust";
  region: CaptureRegion | null;
}

// Window-relative rect (CSS px) to flash a click-target glow over.
export interface GlowFlashRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GlowApi {
  onSetMode(cb: (payload: GlowMode) => void): () => void;
  onFlash(cb: (rect: GlowFlashRect) => void): () => void;
  // The user clicked somewhere — the pointer has done its job (or was wrong).
  onFlashOff(cb: () => void): () => void;
  commit(region: CaptureRegion | null): Promise<void>;
  cancel(): Promise<void>;
}

const glowApi: GlowApi = {
  onSetMode: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, payload: GlowMode) =>
      cb(payload);
    ipcRenderer.on("glow:set-mode", handler);
    return () => ipcRenderer.removeListener("glow:set-mode", handler);
  },
  onFlash: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, rect: GlowFlashRect) =>
      cb(rect);
    ipcRenderer.on("glow:flash", handler);
    return () => ipcRenderer.removeListener("glow:flash", handler);
  },
  onFlashOff: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("glow:flash-off", handler);
    return () => ipcRenderer.removeListener("glow:flash-off", handler);
  },
  commit: (region) => ipcRenderer.invoke("overlay:commit-region", { region }),
  cancel: () => ipcRenderer.invoke("overlay:cancel-adjust"),
};

contextBridge.exposeInMainWorld("glowApi", glowApi);
