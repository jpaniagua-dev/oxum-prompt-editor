import { app, clipboard, ipcMain, shell } from 'electron';
import {
  IpcChannel,
  type AppSettings,
  type BootstrapState,
  type HistoryEntry,
  type LibraryEntry,
  type LibraryId,
  type OpenedFile,
  type RewriteRequest,
  type SnapshotReason,
  type ThemeMode,
  type ThemeState,
} from '@shared/contracts.js';
import type { ThemeController } from './theme.js';
import { mergePresets, resolvePreset } from './claude/presets.js';
import type { RewriteService } from './claude/rewrite-service.js';
import { resetClaudePathCache } from './claude/claude-cli.js';
import type { DraftStore } from './store/draft-store.js';
import type { FileStore } from './store/file-store.js';
import type { HistoryStore } from './store/history-store.js';
import type { LibraryStore } from './store/library-store.js';
import { resolveModelForPreset, type SettingsStore } from './store/settings-store.js';

export interface IpcDependencies {
  readonly drafts: DraftStore;
  readonly history: HistoryStore;
  /** One store per library, which is also the whitelist the renderer's id is checked against. */
  readonly libraries: Readonly<Record<LibraryId, LibraryStore>>;
  /** Markdown files the user opened from anywhere on the disk, read-only. */
  readonly files: FileStore;
  readonly settings: SettingsStore;
  readonly rewrites: RewriteService;
  readonly theme: ThemeController;
  readonly recovered: () => boolean;
  readonly defaultDirectories: () => Readonly<Record<LibraryId, string>>;
  readonly pickDirectory: (current: string) => Promise<string | null>;
  readonly hideWindow: () => void;
  /** The deliberate exit: flush, final snapshot, save bounds, then quit. */
  readonly quit: () => void;
  readonly setAlwaysOnTop: (pinned: boolean) => void;
  readonly onSettingsChanged: (settings: AppSettings, previous: AppSettings) => void;
}

/**
 * Registers every IPC handler.
 *
 * The renderer holds no privileged capability of its own: this module is the complete list
 * of things it is allowed to ask the main process to do.
 */
export function registerIpcHandlers(deps: IpcDependencies): void {
  ipcMain.handle(IpcChannel.Bootstrap, async (): Promise<BootstrapState> => {
    const settings = deps.settings.get();
    return {
      draft: deps.drafts.peek(),
      settings,
      presets: mergePresets(settings.customPresets),
      recovered: deps.recovered(),
      theme: deps.theme.state(),
      defaultDirectories: deps.defaultDirectories(),
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle(IpcChannel.ThemeSet, async (_event, mode: unknown): Promise<ThemeState> => {
    const parsed = asThemeMode(mode);
    const state = deps.theme.setMode(parsed);
    await deps.settings.update({ themeMode: parsed });
    return state;
  });

  // Fire-and-forget: the renderer must never wait on a disk write while typing.
  ipcMain.on(IpcChannel.DraftChanged, (_event, text: unknown) => {
    if (typeof text === 'string') {
      deps.drafts.update(text);
    }
  });

  ipcMain.handle(
    IpcChannel.DraftSnapshot,
    async (_event, text: unknown, reason: unknown): Promise<void> => {
      if (typeof text !== 'string') {
        return;
      }
      await deps.history.snapshot(text, asSnapshotReason(reason), new Date());
    },
  );

  ipcMain.handle(IpcChannel.HistoryList, async (): Promise<HistoryEntry[]> => deps.history.list());

  ipcMain.handle(IpcChannel.HistoryRead, async (_event, id: unknown): Promise<string> => {
    if (typeof id !== 'string') {
      throw new Error('History id must be a string');
    }
    return deps.history.read(id);
  });

  ipcMain.handle(IpcChannel.HistoryClear, async (): Promise<number> => deps.history.clear());

  /**
   * Resolves the library the renderer named.
   *
   * The lookup is what keeps the discriminator safe: the renderer picks from a fixed set of
   * stores rather than handing over a path, so an unexpected value fails here instead of
   * reaching the filesystem.
   */
  const libraryOf = (value: unknown): LibraryStore => {
    const store = value === 'notes' || value === 'prompts' ? deps.libraries[value] : undefined;
    if (store === undefined) {
      throw new Error(`Unknown library: ${String(value)}`);
    }
    return store;
  };

  ipcMain.handle(
    IpcChannel.LibraryList,
    async (_event, library: unknown): Promise<LibraryEntry[]> => libraryOf(library).list(),
  );

  ipcMain.handle(
    IpcChannel.LibraryRead,
    async (_event, library: unknown, id: unknown): Promise<string> => {
      if (typeof id !== 'string') {
        throw new Error('Document id must be a string');
      }
      return libraryOf(library).read(id);
    },
  );

  ipcMain.handle(
    IpcChannel.LibrarySave,
    async (_event, library: unknown, text: unknown): Promise<LibraryEntry> => {
      if (typeof text !== 'string') {
        throw new Error('Document content must be a string');
      }
      return libraryOf(library).save(text);
    },
  );

  ipcMain.handle(
    IpcChannel.LibraryOverwrite,
    async (_event, library: unknown, id: unknown, text: unknown): Promise<LibraryEntry> => {
      if (typeof id !== 'string' || typeof text !== 'string') {
        throw new Error('Document id and content must be strings');
      }
      return libraryOf(library).overwrite(id, text);
    },
  );

  ipcMain.handle(
    IpcChannel.LibraryDelete,
    async (_event, library: unknown, id: unknown): Promise<void> => {
      if (typeof id !== 'string') {
        throw new Error('Document id must be a string');
      }
      await libraryOf(library).delete(id);
    },
  );

  ipcMain.handle(IpcChannel.FileOpen, async (): Promise<OpenedFile | null> => deps.files.open());

  /**
   * Opens a link from the preview in the system browser.
   *
   * The scheme is checked here as well as in the renderer, on the principle that the main
   * process never trusts what comes across the bridge: `shell.openExternal` will happily hand a
   * `file:` URL to the shell, which is a launcher, not a viewer.
   */
  ipcMain.handle(IpcChannel.LinkOpen, async (_event, url: unknown): Promise<void> => {
    if (typeof url !== 'string' || !/^(?:https?:|mailto:)/i.test(url)) {
      return;
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(
    IpcChannel.PickDirectory,
    async (_event, current: unknown): Promise<string | null> =>
      deps.pickDirectory(typeof current === 'string' ? current : ''),
  );

  ipcMain.handle(IpcChannel.ClipboardWrite, async (_event, text: unknown): Promise<void> => {
    if (typeof text === 'string') {
      // Written from the main process so the copy still lands even if the renderer's
      // document has already lost focus on its way to being hidden.
      clipboard.writeText(text);
    }
  });

  ipcMain.on(IpcChannel.WindowHide, () => deps.hideWindow());

  ipcMain.on(IpcChannel.AppQuit, () => deps.quit());

  ipcMain.handle(IpcChannel.WindowSetAlwaysOnTop, async (_event, pinned: unknown): Promise<void> => {
    const value = pinned === true;
    deps.setAlwaysOnTop(value);
    await deps.settings.update({ alwaysOnTop: value });
  });

  ipcMain.handle(
    IpcChannel.SettingsUpdate,
    async (_event, patch: unknown): Promise<AppSettings> => {
      const previous = deps.settings.get();
      const next = await deps.settings.update(asSettingsPatch(patch));
      if (next.claudePath !== previous.claudePath) {
        resetClaudePathCache();
      }
      deps.onSettingsChanged(next, previous);
      return next;
    },
  );

  ipcMain.handle(IpcChannel.RewriteStart, async (_event, request: unknown): Promise<void> => {
    const parsed = asRewriteRequest(request);
    if (parsed === null) {
      return;
    }
    const settings = deps.settings.get();
    const presets = mergePresets(settings.customPresets);
    await deps.rewrites.start({
      requestId: parsed.requestId,
      text: parsed.text,
      preset: resolvePreset(presets, parsed.presetId),
      // Per-action override when there is one, the global default otherwise.
      model: resolveModelForPreset(settings, parsed.presetId),
      maxBudgetUsd: settings.maxBudgetUsd,
      claudePath: settings.claudePath,
    });
  });

  ipcMain.handle(IpcChannel.RewriteCancel, async (_event, requestId: unknown): Promise<void> => {
    if (typeof requestId === 'string') {
      deps.rewrites.cancel(requestId);
    }
  });
}

function asThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

const SNAPSHOT_REASONS: readonly SnapshotReason[] = [
  'copy',
  'new',
  'rewrite',
  'restore',
  'quit',
  'manual',
];

function asSnapshotReason(value: unknown): SnapshotReason {
  return typeof value === 'string' && (SNAPSHOT_REASONS as readonly string[]).includes(value)
    ? (value as SnapshotReason)
    : 'manual';
}

/** Keeps only the keys the renderer is allowed to change. */
function asSettingsPatch(value: unknown): Partial<AppSettings> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const patch: Partial<AppSettings> = {};

  if (typeof input.globalShortcut === 'string') patch.globalShortcut = input.globalShortcut;
  if (input.themeMode !== undefined) patch.themeMode = asThemeMode(input.themeMode);
  if (typeof input.alwaysOnTop === 'boolean') patch.alwaysOnTop = input.alwaysOnTop;
  if (typeof input.hideOnBlur === 'boolean') patch.hideOnBlur = input.hideOnBlur;
  if (typeof input.openAtLogin === 'boolean') patch.openAtLogin = input.openAtLogin;
  if (typeof input.fontSize === 'number') patch.fontSize = input.fontSize;
  if (typeof input.model === 'string') patch.model = input.model;
  if (isModelMap(input.modelByPresetId)) patch.modelByPresetId = input.modelByPresetId;
  if (typeof input.claudePath === 'string') patch.claudePath = input.claudePath;
  if (typeof input.defaultPresetId === 'string') patch.defaultPresetId = input.defaultPresetId;
  if (typeof input.maxBudgetUsd === 'number') patch.maxBudgetUsd = input.maxBudgetUsd;
  if (typeof input.notesDirectory === 'string') patch.notesDirectory = input.notesDirectory;
  if (typeof input.promptsDirectory === 'string') patch.promptsDirectory = input.promptsDirectory;

  return patch;
}

/**
 * Shallow shape check on the per-action model map.
 *
 * `sanitizeSettings` does the real normalising; this only keeps a non-object from reaching it as
 * a patch value, since a patch merges over the stored settings before sanitisation runs.
 */
function isModelMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRewriteRequest(value: unknown): RewriteRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.requestId !== 'string' ||
    typeof input.text !== 'string' ||
    typeof input.presetId !== 'string' ||
    input.text.trim().length === 0
  ) {
    return null;
  }
  return { requestId: input.requestId, text: input.text, presetId: input.presetId };
}
