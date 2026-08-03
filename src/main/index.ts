import { app, type BrowserWindow, type Tray } from 'electron';
import { join } from 'node:path';
import { IpcChannel, type AppSettings, type RewriteEvent } from '@shared/contracts.js';
import { RewriteService } from './claude/rewrite-service.js';
import { registerIpcHandlers } from './ipc.js';
import { registerGlobalShortcut, shortcutLabel, unregisterGlobalShortcuts } from './shortcuts.js';
import { DraftStore } from './store/draft-store.js';
import { HistoryStore } from './store/history-store.js';
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
 * surfaced instead.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
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
    settings: settingsStore,
    rewrites: rewriteService,
    theme: themeController,
    recovered: () => recovered,
    hideWindow: () => popupWindow.hide(),
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
