/**
 * Single source of truth for everything crossing the main <-> renderer boundary.
 *
 * The renderer is sandboxed: it has no `fs`, no `child_process` and no `ipcRenderer`.
 * Every capability it needs is declared here, implemented in the main process and
 * exposed through the narrow, typed bridge in `src/preload/index.ts`.
 */

/** Rewrite presets shipped with the app. User presets extend this set by id. */
export type PresetId =
  | 'structure'
  | 'condense'
  | 'spec'
  | 'fix'
  | 'formal'
  | 'chat'
  | 'translate-en'
  | 'translate-fr'
  | 'translate-de';

/**
 * What a preset *produces*, not what it consumes.
 *
 * `agent-prompt` output is handed to a coding agent, so it is Markdown built around headings,
 * bullets and code fences. `text` output is read by a human, a corrected paragraph or a chat
 * message, where Markdown markers would show up as literal characters. Translation is `text` too:
 * it keeps the input's formatting as it is, rather than adding the structure a prompt would get.
 *
 * Neither family ever appends a section the author did not write.
 */
export type PresetKind = 'agent-prompt' | 'text';

/** What the user picked: an explicit theme, or "follow the OS". */
export type ThemeMode = 'light' | 'dark' | 'system';

/** What `system` actually resolves to at a given moment. */
export type ResolvedTheme = 'light' | 'dark';

/** CLI used for prompt rewrites. Selection is explicit: providers never fall back to each other. */
export type RewriteProvider = 'claude' | 'codex';

/** Settings shared by every local rewrite CLI. */
export interface RewriteCliSettings {
  /** Model alias or full name. An empty Codex model lets the CLI choose its current default. */
  model: string;
  /** Per-action model override, keyed by preset id. */
  modelByPresetId: Record<string, string>;
  /** Absolute path to the CLI. Empty means "resolve automatically". */
  cliPath: string;
}

/** Claude-specific rewrite settings. */
export interface ClaudeRewriteSettings extends RewriteCliSettings {
  /** Hard spend cap per rewrite, passed to `claude --max-budget-usd`. */
  maxBudgetUsd: number;
}

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
  /** Which family the output belongs to. Drives the picker grouping and the panel actions. */
  readonly kind: PresetKind;
  /** Instructions handed to the selected rewrite CLI. */
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
  /** Rewrite CLI selected for every action. */
  rewriteProvider: RewriteProvider;
  /** Claude keeps the pre-0.10 defaults and receives migrated legacy values. */
  claude: ClaudeRewriteSettings;
  /** Codex defaults to its own current model when `model` is empty. */
  codex: RewriteCliSettings;
  /** Default preset used by the Rewrite button and its shortcut. */
  defaultPresetId: string;
  /**
   * Absolute directory holding the notes. Empty means the default under `userData`.
   *
   * Configurable because saved Markdown is worth syncing or versioning, which `%APPDATA%` is not
   * the place for. A relative path is rejected in favour of the default rather than resolved
   * against an ambiguous working directory.
   */
  notesDirectory: string;
  /** Absolute directory holding the prompt library. Same rules as `notesDirectory`. */
  promptsDirectory: string;
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

/**
 * The two folders of saved Markdown, kept apart because they answer different needs.
 *
 * `notes` holds working documents: saved, reopened in the editor, worked on again. `prompts` holds
 * the reusable collection, which is copied to the clipboard rather than loaded, so grabbing one
 * never costs whatever is currently in the editor. Same storage mechanics, different folders and
 * different actions in the panel.
 */
export type LibraryId = 'notes' | 'prompts';

/**
 * One saved document, in either library.
 *
 * Unlike a {@link HistoryEntry}, it is deliberate: the user asked for it, it is named after its
 * own first line, and it is expected to still be there in six months. Nothing prunes it.
 */
export interface LibraryEntry {
  /** File name, e.g. `revue-de-code-angular.md`. Stable id, and what shows up in the folder. */
  readonly id: string;
  /** First meaningful line of the content. */
  readonly title: string;
  /** ISO timestamp of the last write. */
  readonly updatedAt: string;
  /** Character count. */
  readonly size: number;
}

/**
 * A Markdown file living outside the app's own folders, opened through the native dialog.
 *
 * Distinct from a {@link LibraryEntry} on the one point that matters: the app did not create it,
 * does not own its name, and never writes to it. It is where the buffer came from, not a
 * destination, which is why nothing here needs authorising.
 */
export interface ExternalFile {
  /** Absolute path, as resolved by the main process. Shown in full only in a tooltip. */
  readonly path: string;
  /** Base name, e.g. `notes-reunion.md`, which is what the status bar displays. */
  readonly name: string;
}

/** An {@link ExternalFile} together with its content, as returned by the open dialog. */
export interface OpenedFile extends ExternalFile {
  readonly text: string;
}

/** Payload restored at startup so the renderer can rebuild its exact previous state. */
export interface BootstrapState {
  readonly draft: string;
  readonly settings: AppSettings;
  readonly presets: RewritePreset[];
  /** True when the draft was recovered from disk rather than starting empty. */
  readonly recovered: boolean;
  /** Theme resolved by the main process, so the first paint is already correct. */
  readonly theme: ThemeState;
  /** Defaults per library, shown as the placeholder of each directory field. */
  readonly defaultDirectories: Readonly<Record<LibraryId, string>>;
  /** Shown in the status bar, so what is running is answerable without leaving the window. */
  readonly appVersion: string;
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
  /** invoke: () => number, deletes every snapshot and returns how many went */
  HistoryClear: 'history:clear',
  /*
   * The library channels each take a `LibraryId` first. One typed discriminator beats five more
   * channel names: the renderer still cannot name an arbitrary destination, since the id is
   * checked against a fixed map in the main process.
   */
  /** invoke: (library: LibraryId) => LibraryEntry[] */
  LibraryList: 'library:list',
  /** invoke: (library: LibraryId, id: string) => string */
  LibraryRead: 'library:read',
  /** invoke: (library: LibraryId, text: string) => LibraryEntry, named after its first line */
  LibrarySave: 'library:save',
  /** invoke: (library: LibraryId, id: string, text: string) => LibraryEntry */
  LibraryOverwrite: 'library:overwrite',
  /** invoke: (library: LibraryId, id: string) => void */
  LibraryDelete: 'library:delete',
  /**
   * invoke: () => OpenedFile | null, native open dialog then read.
   *
   * Read is the only direction: there is deliberately no `file:save` channel. The app produces
   * text to copy out, kept in the draft and in the two libraries, so an external file is an
   * input to that flow. Writing to an arbitrary absolute path would need the main process to
   * track authorisations it has no other reason to hold.
   */
  FileOpen: 'file:open',
  /** invoke: (url: string) => void, hands an http/https/mailto link to the system browser */
  LinkOpen: 'link:open',
  /** invoke: (current: string) => string | null, native folder picker */
  PickDirectory: 'dialog:pick-directory',
  /** invoke: (text: string) => void, writes the clipboard from the main process */
  ClipboardWrite: 'clipboard:write',
  /** send: () => void */
  WindowHide: 'window:hide',
  /**
   * send: () => void, the same deliberate exit as the tray menu.
   *
   * Routed to the main process rather than closing the window: quitting has to flush the draft,
   * take a final snapshot and save the bounds first. A renderer-side `window.close()` would skip
   * all three.
   */
  AppQuit: 'app:quit',
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
  clearHistory(): Promise<number>;
  listLibrary(library: LibraryId): Promise<LibraryEntry[]>;
  readLibraryEntry(library: LibraryId, id: string): Promise<string>;
  saveToLibrary(library: LibraryId, text: string): Promise<LibraryEntry>;
  overwriteLibraryEntry(library: LibraryId, id: string, text: string): Promise<LibraryEntry>;
  deleteLibraryEntry(library: LibraryId, id: string): Promise<void>;
  openFile(): Promise<OpenedFile | null>;
  openExternalLink(url: string): Promise<void>;
  pickDirectory(current: string): Promise<string | null>;
  writeClipboard(text: string): Promise<void>;
  hideWindow(): void;
  quitApp(): void;
  setAlwaysOnTop(pinned: boolean): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  startRewrite(request: RewriteRequest): Promise<void>;
  cancelRewrite(requestId: string): Promise<void>;
  onRewriteEvent(listener: (event: RewriteEvent) => void): () => void;
  onRequestFlush(listener: () => void): () => void;
  setThemeMode(mode: ThemeMode): Promise<ThemeState>;
  onThemeChanged(listener: (state: ThemeState) => void): () => void;
}
