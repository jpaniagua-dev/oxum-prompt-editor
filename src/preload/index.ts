import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AppSettings,
  type BootstrapState,
  type HistoryEntry,
  type RendererApi,
  type RewriteEvent,
  type RewriteRequest,
  type SnapshotReason,
} from '@shared/contracts.js';

/**
 * The only bridge between the sandboxed renderer and the main process.
 *
 * Nothing generic is exposed: no `ipcRenderer`, no channel name passthrough, no `require`.
 * Each method below is one capability, so the renderer's blast radius is exactly this list.
 */
const api: RendererApi = {
  bootstrap: (): Promise<BootstrapState> => ipcRenderer.invoke(IpcChannel.Bootstrap),

  notifyDraftChanged: (text: string): void => {
    ipcRenderer.send(IpcChannel.DraftChanged, text);
  },

  snapshotDraft: (text: string, reason: SnapshotReason): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.DraftSnapshot, text, reason),

  listHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IpcChannel.HistoryList),

  readHistory: (id: string): Promise<string> => ipcRenderer.invoke(IpcChannel.HistoryRead, id),

  writeClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ClipboardWrite, text),

  hideWindow: (): void => {
    ipcRenderer.send(IpcChannel.WindowHide);
  },

  setAlwaysOnTop: (pinned: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.WindowSetAlwaysOnTop, pinned),

  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IpcChannel.SettingsUpdate, patch),

  startRewrite: (request: RewriteRequest): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.RewriteStart, request),

  cancelRewrite: (requestId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.RewriteCancel, requestId),

  onRewriteEvent: (listener: (event: RewriteEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: RewriteEvent): void => listener(payload);
    ipcRenderer.on(IpcChannel.RewriteEvent, handler);
    return () => ipcRenderer.off(IpcChannel.RewriteEvent, handler);
  },

  onRequestFlush: (listener: () => void): (() => void) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.RequestFlush, handler);
    return () => ipcRenderer.off(IpcChannel.RequestFlush, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
