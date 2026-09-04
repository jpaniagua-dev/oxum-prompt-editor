import { describe, expect, it } from 'vitest';
import {
  acceleratorLabel,
  APP_SHORTCUTS,
  EDITOR_SHORTCUTS,
  FORMAT_SHORTCUTS,
  formatCommandLabel,
  formatShortcutLabel,
  shortcutLabel,
  WINDOW_SHORTCUTS,
  windowCommandFor,
  type AppCommandId,
} from '../src/renderer/editor/shortcuts.js';

/**
 * The catalogue is the single source for the keymap, the window handler and the help panel, so
 * what is worth testing is not that a given key does a given thing, but that the tables stay
 * coherent: no duplicate key, no shortcut without a label, nothing the help panel would render
 * as an empty cap.
 */
describe('shortcut catalogue', () => {
  const declared = [...APP_SHORTCUTS, ...WINDOW_SHORTCUTS, ...FORMAT_SHORTCUTS];

  it('binds every key exactly once', () => {
    const keys = [...declared, ...EDITOR_SHORTCUTS].map((entry) => entry.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('binds every command exactly once', () => {
    const commands = declared.map((entry) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it('labels every shortcut', () => {
    for (const entry of [...declared, ...EDITOR_SHORTCUTS]) {
      expect(entry.label.trim().length, entry.key).toBeGreaterThan(0);
    }
  });

  /**
   * The help panel is only as truthful as this: an app command added to the keymap without an
   * entry here would be a working shortcut nothing documents.
   */
  it('covers every app command the keymap can run', () => {
    const expected: readonly AppCommandId[] = [
      'copyAndHide',
      'copyOnly',
      'rewriteDefault',
      'rewritePick',
      'newPrompt',
      'toggleLibrary',
      'showNotes',
      'showHistory',
      'toggleSettings',
      'toggleHelp',
      'cycleTheme',
      'escape',
    ];
    expect([...APP_SHORTCUTS.map((entry) => entry.command)].sort()).toEqual([...expected].sort());
  });

  /**
   * The layout trap this app was bitten by: on a Swiss/French keyboard `Ctrl+Shift+7` arrives as
   * `Ctrl+/` and triggers the comment toggle. Digits are only safe unshifted.
   */
  it('never combines Shift with a digit', () => {
    for (const entry of declared) {
      expect(/Shift-\d/.test(entry.key), entry.key).toBe(false);
    }
  });

  /** Chromium keeps this one for its bookmark manager; it never reaches the renderer. */
  it('never binds Ctrl+Shift+O', () => {
    expect(declared.some((entry) => entry.key.toLowerCase() === 'mod-shift-o')).toBe(false);
  });
});

describe('shortcutLabel', () => {
  it('renders modifiers in the UI language', () => {
    expect(shortcutLabel('Mod-Shift-d')).toBe('Ctrl+Maj+D');
    expect(shortcutLabel('Mod-Enter')).toBe('Ctrl+Entrée');
    expect(shortcutLabel('Escape')).toBe('Échap');
    expect(shortcutLabel('Alt-ArrowUp')).toBe('Alt+↑');
  });

  it('leaves punctuation and function keys alone', () => {
    expect(shortcutLabel('Mod-,')).toBe('Ctrl+,');
    expect(shortcutLabel('Mod-Shift-.')).toBe('Ctrl+Maj+.');
    expect(shortcutLabel('F1')).toBe('F1');
  });

  it('renders an Electron accelerator the same way', () => {
    expect(acceleratorLabel('Control+Alt+Space')).toBe('Ctrl+Alt+Espace');
  });

  it('never produces an empty cap, which the help panel would render as a blank key', () => {
    for (const entry of [...APP_SHORTCUTS, ...WINDOW_SHORTCUTS, ...FORMAT_SHORTCUTS]) {
      for (const part of shortcutLabel(entry.key).split('+')) {
        expect(part.length, entry.key).toBeGreaterThan(0);
      }
    }
  });
});

describe('lookups', () => {
  it('resolves a window shortcut from a raw event key', () => {
    expect(windowCommandFor('p')).toBe('togglePreview');
    expect(windowCommandFor('O')).toBe('openFile');
    expect(windowCommandFor('q')).toBeNull();
    // Nothing writes to disk any more, so Ctrl+S must resolve to no command at all.
    expect(windowCommandFor('s')).toBeNull();
  });

  it('gives the format bar its wording and its shortcut', () => {
    expect(formatCommandLabel('bold')).toBe('Gras');
    expect(formatShortcutLabel('bold')).toBe('Ctrl+B');
  });
});
