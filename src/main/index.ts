import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type Tray,
} from 'electron';
import { join } from 'node:path';
import { IpcChannel, type AppSettings, type RewriteEvent } from '@shared/contracts.js';
import { registerIpcHandlers } from './ipc.js';
import { RewriteService } from './rewrite/rewrite-service.js';
import { registerGlobalShortcut, shortcutLabel, unregisterGlobalShortcuts } from './shortcuts.js';
import { DraftStore } from './store/draft-store.js';
import { FileStore } from './store/file-store.js';
import { HistoryStore } from './store/history-store.js';
import { LibraryStore } from './store/library-store.js';
import { AppPaths } from './store/paths.js';
import { SettingsStore } from './store/settings-store.js';
import { WindowStateStore } from './store/window-state.js';
import { ThemeController } from './theme.js';
import { createTray } from './tray.js';
import { PopupWindow, markQuitting, preloadPath } from './window.js';

/**
 * Development runs get their own data directory.
 *
 * Sharing `userData` with the installed app means sharing the draft file, the history and the
 * single-instance lock. Two concrete consequences: running from source overwrites real drafts
 * with test text, and it silently refuses to start whenever the installed app is already open.
 * Must happen before the lock is requested, since the lock is keyed on this directory.
 */
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

/**
 * A second launch must not open a second editor: it would compete for the same draft file
 * and one of the two buffers would be silently overwritten. The existing instance is
 * surfaced instead, through the `second-instance` handler at the end of `bootstrap`.
 *
 * `app.exit` rather than `app.quit`: `quit` is asynchronous and does not stop this script, so
 * the losing process went on to run `bootstrap()` anyway and opened the very `draft.md` and
 * `settings.json` the winner is already writing to. Two writers on the draft is exactly what
 * the lock exists to prevent. Nothing has been created at this point, so there is nothing to
 * tear down gracefully.
 *
 * Note that the lock is keyed on `userData`, which every packaged build shares: launching a
 * newer build while an older one is running surfaces the *old* window and exits here.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

let tray: Tray | null = null;
let popup: PopupWindow | null = null;
let drafts: DraftStore | null = null;
let history: HistoryStore | null = null;
let recovered = false;
let activeShortcut: string | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const settingsStore = new SettingsStore(AppPaths.settings());
  const settings = await settingsStore.load();

  const draftStore = new DraftStore(AppPaths.draft());
  const loaded = await draftStore.load();
  recovered = loaded.recovered;
  drafts = draftStore;

  const historyStore = new HistoryStore(AppPaths.historyDir());
  history = historyStore;

  // One store per library, each resolving its directory on every access rather than capturing
  // it: the directories are settings, and a store holding the old path would keep writing where
  // the UI no longer looks.
  const libraries = {
    notes: new LibraryStore(() =>
      resolveDirectory(settingsStore.get().notesDirectory, AppPaths.defaultNotesDir()),
    ),
    prompts: new LibraryStore(() =>
      resolveDirectory(settingsStore.get().promptsDirectory, AppPaths.defaultPromptsDir()),
    ),
  } as const;
  // Files the user opens from outside the app's own folders. Instantiated before the window
  // because the dialog it drives needs to be parented to it, which the closure below does lazily.
  const fileStore = new FileStore({
    chooseToOpen: () => pickMarkdownFile(popup?.browserWindow ?? null),
  });

  const windowStateStore = new WindowStateStore(AppPaths.windowState());

  const popupWindow = new PopupWindow(windowStateStore, {
    onBeforeHide: () => {
      void draftStore.flush();
    },
    shouldHideOnBlur: () => settingsStore.get().hideOnBlur,
  });
  popup = popupWindow;

  const rewriteService = new RewriteService((event: RewriteEvent) => {
    popupWindow.browserWindow?.webContents.send(IpcChannel.RewriteEvent, event);
  });

  const themeController = new ThemeController(
    (state) => popupWindow.browserWindow?.webContents.send(IpcChannel.ThemeChanged, state),
    (color) => popupWindow.setBackgroundColor(color),
  );
  // Apply the stored mode before the window exists, so its very first paint is already the
  // right colour instead of flashing the default white.
  themeController.setMode(settings.themeMode);

  registerIpcHandlers({
    drafts: draftStore,
    history: historyStore,
    libraries,
    files: fileStore,
    settings: settingsStore,
    rewrites: rewriteService,
    theme: themeController,
    recovered: () => recovered,
    defaultDirectories: () => ({
      notes: AppPaths.defaultNotesDir(),
      prompts: AppPaths.defaultPromptsDir(),
    }),
    pickDirectory: (current) => pickDirectory(popupWindow.browserWindow, current),
    hideWindow: () => popupWindow.hide(),
    quit: () => void quit(),
    setAlwaysOnTop: (pinned) => popupWindow.setAlwaysOnTop(pinned),
    onSettingsChanged: (next, previous) => applySettingsChange(next, previous, popupWindow),
  });

  const window = await popupWindow.create({
    alwaysOnTop: settings.alwaysOnTop,
    preloadPath: preloadPath(),
    backgroundColor: themeController.backgroundColor(),
  });
  await loadRenderer(window);

  activeShortcut = registerGlobalShortcut(settings.globalShortcut, () => popupWindow.toggle());
  if (activeShortcut !== null && activeShortcut !== settings.globalShortcut) {
    // Persist what actually works, so the UI never advertises a dead shortcut.
    await settingsStore.update({ globalShortcut: activeShortcut });
  }

  tray = createTray({
    onToggle: () => popupWindow.toggle(),
    onQuit: () => void quit(),
    shortcutLabel: shortcutLabel(activeShortcut),
  });

  applyLoginItem(settings.openAtLogin);

  // Started by the login item, or manually: `--hidden` keeps the window out of the way
  // until the shortcut is pressed.
  const startHidden = process.argv.includes('--hidden');
  if (!startHidden) {
    popupWindow.show();
  }

  app.on('second-instance', () => popupWindow.show());
  app.on('window-all-closed', () => {
    // Intentionally empty: the app lives in the tray, closing the window is not quitting.
  });
  app.on('before-quit', () => {
    markQuitting();
    rewriteService.cancelAll();
  });
}

/**
 * Where a library actually lives.
 *
 * `sanitizeSettings` has already rejected a relative path, so an empty value is the only
 * "unset" state to handle here.
 */
function resolveDirectory(configured: string, fallback: string): string {
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Native folder picker for the notes directory.
 *
 * Modal to the popup on purpose: a sheet the user can lose behind an always-on-top window is
 * worse than one that blocks it, and the picker is short-lived.
 */
async function pickDirectory(parent: BrowserWindow | null, current: string): Promise<string | null> {
  const options: OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    ...(current.trim().length > 0 ? { defaultPath: current.trim() } : {}),
  };
  const result =
    parent === null || parent.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options);

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * Native picker for an existing Markdown file.
 *
 * The filter leads with Markdown but keeps "all files" available: a Markdown document saved as
 * `.txt` is still one, and refusing to open it would be the app deciding what the user meant.
 */
async function pickMarkdownFile(parent: BrowserWindow | null): Promise<string | null> {
  const options: OpenDialogOptions = {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  };
  const result =
    parent === null || parent.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options);

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Loads the renderer from the dev server when available, from disk otherwise. */
async function loadRenderer(window: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl !== undefined && devServerUrl.length > 0) {
    await window.loadURL(devServerUrl);
    return;
  }
  await window.loadFile(join(__dirname, '../renderer/index.html'));
}

/** Re-applies the settings that have side effects outside the renderer. */
function applySettingsChange(
  next: AppSettings,
  previous: AppSettings,
  popupWindow: PopupWindow,
): void {
  if (next.globalShortcut !== previous.globalShortcut) {
    activeShortcut = registerGlobalShortcut(next.globalShortcut, () => popupWindow.toggle());
  }
  if (next.alwaysOnTop !== previous.alwaysOnTop) {
    popupWindow.setAlwaysOnTop(next.alwaysOnTop);
  }
  if (next.openAtLogin !== previous.openAtLogin) {
    applyLoginItem(next.openAtLogin);
  }
}

function applyLoginItem(openAtLogin: boolean): void {
  // Not available when running through the dev server binary, and pointless there anyway.
  if (!app.isPackaged) {
    return;
  }
  app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] });
}

/**
 * Quits after making sure nothing typed is lost.
 *
 * The renderer is asked to flush first, then the draft is written and archived, and only
 * then does the process exit.
 */
async function quit(): Promise<void> {
  markQuitting();
  unregisterGlobalShortcuts();

  const window = popup?.browserWindow;
  if (window !== null && window !== undefined && !window.isDestroyed()) {
    window.webContents.send(IpcChannel.RequestFlush);
    // Give the renderer a beat to hand over its buffer before the process goes away.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  await drafts?.flush();

  // One last archived copy, so even a draft the user never explicitly copied survives.
  const finalText = drafts?.peek() ?? '';
  if (finalText.trim().length > 0) {
    await history?.snapshot(finalText, 'quit', new Date());
  }

  await popup?.saveBounds();
  tray?.destroy();
  app.quit();
}
