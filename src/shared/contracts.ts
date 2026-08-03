/**
 * Single source of truth for everything crossing the main <-> renderer boundary.
 *
 * The renderer is sandboxed: it has no `fs`, no `child_process` and no `ipcRenderer`.
 * Every capability it needs is declared here, implemented in the main process and
 * exposed through the narrow, typed bridge in `src/preload/index.ts`.
 */

/** Rewrite presets shipped with the app. User presets extend this set by id. */
export type PresetId = 'structure' | 'translate-en' | 'condense' | 'spec';

/** What the user picked: an explicit theme, or "follow the OS". */
export type ThemeMode = 'light' | 'dark' | 'system';

/** What `system` actually resolves to at a given moment. */
export type ResolvedTheme = 'light' | 'dark';

/** The chosen mode together with the theme currently in effect. */
export interface ThemeState {
  readonly mode: ThemeMode;
  readonly resolved: ResolvedTheme;
}

/** A rewrite mode: a label for the UI plus the system prompt driving the CLI. */
export interface RewritePreset {
  readonly id: string;
  /** Short label shown in the toolbar and the preset picker. */
  readonly label: string;
  /** One-line explanation of what this preset does to the draft. */
  readonly hint: string;
  /** System prompt handed to `claude --system-prompt`. */
  readonly systemPrompt: string;
}

/** Persisted user settings. Every field has a default in `settings-store.ts`. */
export interface AppSettings {
  /** Electron accelerator toggling window visibility, e.g. `Control+Alt+Space`. */
  globalShortcut: string;
  /** Light, dark, or follow the operating system. */
  themeMode: ThemeMode;
  /** Keep the window above other windows. Toggled by the pin button. */
  alwaysOnTop: boolean;
  /** Hide the window when it loses focus. Off by default: losing the popup mid-thought is worse than a stray window. */
  hideOnBlur: boolean;
  /** Launch at Windows sign-in, started hidden. */
  openAtLogin: boolean;
  /** Editor font size in px. */
  fontSize: number;
  /** Model alias or full name passed to `claude --model`. */
  model: string;
  /** Absolute path to the Claude CLI. Empty means "resolve automatically". */
  claudePath: string;
  /** Default preset used by the Rewrite button and its shortcut. */
  defaultPresetId: string;
  /** Hard spend cap per rewrite, passed to `claude --max-budget-usd`. */
  maxBudgetUsd: number;
  /** User-defined or overridden presets, merged over the built-ins by id. */
  customPresets: RewritePreset[];
}

/** Window bounds remembered across sessions. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One archived snapshot of a draft. */
export interface HistoryEntry {
  /** File name, used as the stable id. */
  readonly id: string;
  /** ISO timestamp of when the snapshot was taken. */
  readonly savedAt: string;
  /** Why the snapshot exists, shown in the history panel. */
  readonly reason: SnapshotReason;
  /** First meaningful line, for the list display. */
  readonly title: string;
  /** Character count of the snapshot. */
  readonly size: number;
}

export type SnapshotReason = 'copy' | 'new' | 'rewrite' | 'restore' | 'quit' | 'manual';

/** Payload restored at startup so the renderer can rebuild its exact previous state. */
export interface BootstrapState {
  readonly draft: string;
  readonly settings: AppSettings;
  readonly presets: RewritePreset[];
  /** True when the draft was recovered from disk rather than starting empty. */
  readonly recovered: boolean;
  /** Theme resolved by the main process, so the first paint is already correct. */
  readonly theme: ThemeState;
}

/* ------------------------------------------------------------------ *
 * Rewrite streaming events (main -> renderer)
 * ------------------------------------------------------------------ */

/** Incremental text as the CLI streams its answer. */
export interface RewriteChunkEvent {
  readonly type: 'chunk';
  readonly requestId: string;
  readonly text: string;
}

/** Terminal success event carrying the full result and its cost. */
export interface RewriteDoneEvent {
  readonly type: 'done';
  readonly requestId: string;
  readonly text: string;
  readonly costUsd: number | null;
  readonly durationMs: number;
}

/** Terminal failure event. `reason` distinguishes user cancel from real errors. */
export interface RewriteErrorEvent {
  readonly type: 'error';
  readonly requestId: string;
  readonly reason: 'cancelled' | 'timeout' | 'cli-missing' | 'cli-failed';
  readonly message: string;
}

export type RewriteEvent = RewriteChunkEvent | RewriteDoneEvent | RewriteErrorEvent;

/* ------------------------------------------------------------------ *
 * IPC channel names
 * ------------------------------------------------------------------ */

export const IpcChannel = {
  /** invoke: () => BootstrapState */
  Bootstrap: 'app:bootstrap',
  /** send: (text: string) => void, debounced autosave */
  DraftChanged: 'draft:changed',
  /** invoke: (text: string, reason: SnapshotReason) => void */
  DraftSnapshot: 'draft:snapshot',
  /** invoke: () => HistoryEntry[] */
  HistoryList: 'history:list',
  /** invoke: (id: string) => string */
  HistoryRead: 'history:read',
  /** invoke: (text: string) => void, writes the clipboard from the main process */
  ClipboardWrite: 'clipboard:write',
  /** send: () => void */
  WindowHide: 'window:hide',
  /** invoke: (pinned: boolean) => void */
  WindowSetAlwaysOnTop: 'window:set-always-on-top',
  /** invoke: (patch: Partial<AppSettings>) => AppSettings */
  SettingsUpdate: 'settings:update',
  /** invoke: ({ requestId, text, presetId }) => void, result arrives on RewriteEvent */
  RewriteStart: 'rewrite:start',
  /** invoke: (requestId: string) => void */
  RewriteCancel: 'rewrite:cancel',
  /** on: (event: RewriteEvent) => void */
  RewriteEvent: 'rewrite:event',
  /** on: () => void, main asks the renderer to flush its buffer before quitting */
  RequestFlush: 'app:request-flush',
  /** invoke: (mode: ThemeMode) => ThemeState */
  ThemeSet: 'theme:set',
  /** on: (state: ThemeState) => void, also fires when the OS theme changes */
  ThemeChanged: 'theme:changed',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

/** Arguments for a rewrite request. */
export interface RewriteRequest {
  readonly requestId: string;
  readonly text: string;
  readonly presetId: string;
}

/**
 * The API surface exposed on `window.api`. Kept deliberately small: each member
 * maps to exactly one capability the renderer genuinely needs.
 */
export interface RendererApi {
  bootstrap(): Promise<BootstrapState>;
  notifyDraftChanged(text: string): void;
  snapshotDraft(text: string, reason: SnapshotReason): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  readHistory(id: string): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  hideWindow(): void;
  setAlwaysOnTop(pinned: boolean): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  startRewrite(request: RewriteRequest): Promise<void>;
  cancelRewrite(requestId: string): Promise<void>;
  onRewriteEvent(listener: (event: RewriteEvent) => void): () => void;
  onRequestFlush(listener: () => void): () => void;
  setThemeMode(mode: ThemeMode): Promise<ThemeState>;
  onThemeChanged(listener: (state: ThemeState) => void): () => void;
}
