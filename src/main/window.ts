import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import type { WindowBounds } from '@shared/contracts.js';
import type { WindowStateStore } from './store/window-state.js';

/** Debounce for persisting bounds while the user drags or resizes. */
const BOUNDS_SAVE_DEBOUNCE_MS = 400;

/**
 * Owns the single popup window.
 *
 * The window is created once at startup and then only shown and hidden, never destroyed.
 * That is what makes the global shortcut feel instant: paying Electron's cold start on
 * every invocation would defeat the point of a scratchpad you reach for mid-thought.
 */
export class PopupWindow {
  private window: BrowserWindow | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly stateStore: WindowStateStore,
    private readonly hooks: {
      /** Called whenever the window is about to disappear, so the draft can be flushed. */
      onBeforeHide: () => void;
      /** Reports whether the window should hide when focus is lost. */
      shouldHideOnBlur: () => boolean;
    },
  ) {}

  async create(options: { alwaysOnTop: boolean; preloadPath: string }): Promise<BrowserWindow> {
    const bounds = await this.stateStore.load();
    const position = resolvePosition(bounds);

    const window = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      ...position,
      minWidth: 380,
      minHeight: 260,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#12141a',
      alwaysOnTop: options.alwaysOnTop,
      skipTaskbar: false,
      title: 'Oxum Prompt Editor',
      webPreferences: {
        preload: options.preloadPath,
        // The renderer handles untrusted-by-default text and shells out to nothing:
        // it gets no Node access, no shared context, and cannot reach the filesystem.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true,
      },
    });

    window.setMenuBarVisibility(false);

    // Any link in the editor opens in the real browser instead of hijacking the popup.
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });

    window.on('close', (event) => {
      // Closing must never destroy the buffer: the window hides, and quitting is an
      // explicit action from the tray menu.
      if (!isQuitting) {
        event.preventDefault();
        this.hide();
      }
    });

    window.on('blur', () => {
      this.hooks.onBeforeHide();
      if (this.hooks.shouldHideOnBlur()) {
        this.hide();
      }
    });

    window.on('resize', () => this.scheduleBoundsSave());
    window.on('move', () => this.scheduleBoundsSave());

    this.window = window;
    return window;
  }

  /** Shows and focuses the window, centring it the first time it is ever displayed. */
  show(): void {
    const window = this.window;
    if (window === null) {
      return;
    }
    if (!window.isVisible()) {
      window.show();
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  }

  hide(): void {
    const window = this.window;
    if (window === null || !window.isVisible()) {
      return;
    }
    this.hooks.onBeforeHide();
    window.hide();
  }

  toggle(): void {
    const window = this.window;
    if (window === null) {
      return;
    }
    if (window.isVisible() && window.isFocused()) {
      this.hide();
    } else {
      this.show();
    }
  }

  setAlwaysOnTop(pinned: boolean): void {
    this.window?.setAlwaysOnTop(pinned);
  }

  get browserWindow(): BrowserWindow | null {
    return this.window;
  }

  /** Persists bounds immediately, for the quit path. */
  async saveBounds(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const window = this.window;
    if (window === null || window.isDestroyed()) {
      return;
    }
    await this.stateStore.save(window.getBounds());
  }

  private scheduleBoundsSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      void this.saveBounds();
    }, BOUNDS_SAVE_DEBOUNCE_MS);
  }
}

/** Set by the app before a genuine quit, so `close` stops being intercepted. */
let isQuitting = false;

/** Marks the app as quitting so the next window close is allowed through. */
export function markQuitting(): void {
  isQuitting = true;
}

/** Resolves the preload script path for both dev and packaged runs. */
export function preloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

/** `-1/-1` means "never positioned yet": centre on the display holding the cursor. */
function resolvePosition(bounds: WindowBounds): { x?: number; y?: number; center?: boolean } {
  if (bounds.x !== -1 || bounds.y !== -1) {
    return { x: bounds.x, y: bounds.y };
  }
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return {
    x: Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - bounds.height) / 2),
  };
}
