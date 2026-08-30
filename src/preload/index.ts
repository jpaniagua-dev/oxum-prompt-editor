import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AppSettings,
  type BootstrapState,
  type HistoryEntry,
  type LibraryEntry,
  type LibraryId,
  type ExternalFile,
  type OpenedFile,
  type RendererApi,
  type RewriteEvent,
  type RewriteRequest,
  type SnapshotReason,
  type ThemeMode,
  type ThemeState,
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

  clearHistory: (): Promise<number> => ipcRenderer.invoke(IpcChannel.HistoryClear),

  listLibrary: (library: LibraryId): Promise<LibraryEntry[]> =>
    ipcRenderer.invoke(IpcChannel.LibraryList, library),

  readLibraryEntry: (library: LibraryId, id: string): Promise<string> =>
    ipcRenderer.invoke(IpcChannel.LibraryRead, library, id),

  saveToLibrary: (library: LibraryId, text: string): Promise<LibraryEntry> =>
    ipcRenderer.invoke(IpcChannel.LibrarySave, library, text),

  overwriteLibraryEntry: (library: LibraryId, id: string, text: string): Promise<LibraryEntry> =>
    ipcRenderer.invoke(IpcChannel.LibraryOverwrite, library, id, text),

  deleteLibraryEntry: (library: LibraryId, id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.LibraryDelete, library, id),

  openFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke(IpcChannel.FileOpen),

  saveFile: (path: string, text: string): Promise<ExternalFile> =>
    ipcRenderer.invoke(IpcChannel.FileSave, path, text),

  saveFileAs: (text: string): Promise<ExternalFile | null> =>
    ipcRenderer.invoke(IpcChannel.FileSaveAs, text),

  openExternalLink: (url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.LinkOpen, url),

  pickDirectory: (current: string): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannel.PickDirectory, current),

  writeClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ClipboardWrite, text),

  hideWindow: (): void => {
    ipcRenderer.send(IpcChannel.WindowHide);
  },

  quitApp: (): void => {
    ipcRenderer.send(IpcChannel.AppQuit);
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

  setThemeMode: (mode: ThemeMode): Promise<ThemeState> =>
    ipcRenderer.invoke(IpcChannel.ThemeSet, mode),

  onThemeChanged: (listener: (state: ThemeState) => void): (() => void) => {
    const handler = (_event: unknown, payload: ThemeState): void => listener(payload);
    ipcRenderer.on(IpcChannel.ThemeChanged, handler);
    return () => ipcRenderer.off(IpcChannel.ThemeChanged, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
