import { clipboard, ipcMain } from 'electron';
import {
  IpcChannel,
  type AppSettings,
  type BootstrapState,
  type HistoryEntry,
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
import type { HistoryStore } from './store/history-store.js';
import type { SettingsStore } from './store/settings-store.js';

export interface IpcDependencies {
  readonly drafts: DraftStore;
  readonly history: HistoryStore;
  readonly settings: SettingsStore;
  readonly rewrites: RewriteService;
  readonly theme: ThemeController;
  readonly recovered: () => boolean;
  readonly hideWindow: () => void;
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

  ipcMain.handle(IpcChannel.ClipboardWrite, async (_event, text: unknown): Promise<void> => {
    if (typeof text === 'string') {
      // Written from the main process so the copy still lands even if the renderer's
      // document has already lost focus on its way to being hidden.
      clipboard.writeText(text);
    }
  });

  ipcMain.on(IpcChannel.WindowHide, () => deps.hideWindow());

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
      model: settings.model,
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
  if (typeof input.claudePath === 'string') patch.claudePath = input.claudePath;
  if (typeof input.defaultPresetId === 'string') patch.defaultPresetId = input.defaultPresetId;
  if (typeof input.maxBudgetUsd === 'number') patch.maxBudgetUsd = input.maxBudgetUsd;

  return patch;
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
