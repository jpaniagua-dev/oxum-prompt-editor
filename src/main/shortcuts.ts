import { globalShortcut } from 'electron';

/** Used when the configured accelerator is rejected by the OS. */
const FALLBACK_ACCELERATOR = 'Control+Alt+Space';

/**
 * Registers the global show/hide accelerator.
 *
 * A shortcut can be silently unavailable because another app already owns it. Rather than
 * leaving the user with a popup they cannot summon, registration falls back to the default
 * and reports what actually took effect.
 *
 * @returns The accelerator now in effect, or null when nothing could be registered.
 */
export function registerGlobalShortcut(accelerator: string, onTrigger: () => void): string | null {
  globalShortcut.unregisterAll();

  for (const candidate of dedupe([accelerator, FALLBACK_ACCELERATOR])) {
    if (candidate.length === 0) {
      continue;
    }
    try {
      if (globalShortcut.register(candidate, onTrigger) && globalShortcut.isRegistered(candidate)) {
        return candidate;
      }
    } catch (error) {
      console.error('[shortcuts] invalid accelerator', candidate, error);
    }
  }

  console.error('[shortcuts] no accelerator could be registered; use the tray icon instead');
  return null;
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

/** Human-readable form for tooltips and menus. */
export function shortcutLabel(accelerator: string | null): string {
  if (accelerator === null) {
    return 'raccourci indisponible';
  }
  return accelerator.replace(/Control/g, 'Ctrl').replace(/\+/g, '+');
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
