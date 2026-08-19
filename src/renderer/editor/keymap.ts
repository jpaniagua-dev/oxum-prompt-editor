import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { MarkdownCommands, type MarkdownCommandId } from './markdown-commands.js';

export interface AppCommands {
  /** Copy the whole document, then hide the window. */
  copyAndHide: () => void;
  /** Copy the whole document, keeping the window open. */
  copyOnly: () => void;
  /** Rewrite with the default preset. */
  rewriteDefault: () => void;
  /** Open the preset picker. */
  rewritePick: () => void;
  /** Archive the current text, then clear the editor. */
  newPrompt: () => void;
  /** Toggle the history panel. */
  toggleHistory: () => void;
  /** Toggle the notes panel. */
  toggleNotes: () => void;
  /** Toggle the prompt library panel. */
  togglePrompts: () => void;
  /** Toggle the settings overlay. */
  toggleSettings: () => void;
  /** Step through light, dark and system. */
  cycleTheme: () => void;
  /** Close the open panel, or hide the window when there is none. */
  escape: () => void;
}

/**
 * Formatting shortcuts.
 *
 * `Ctrl+B`, `Ctrl+I` and `Ctrl+K` are universal, so they are kept. The list bindings use
 * **letters** (u/o/t for unordered, ordered, task) rather than the digits the Google Docs
 * convention would suggest, because digit shortcuts are layout dependent: on a Swiss/French
 * keyboard `Shift+7` is physically the `/` key, so `Ctrl+Shift+7` arrives as `Ctrl+/` and gets
 * claimed by CodeMirror's comment toggle. Letters resolve identically on every layout.
 *
 * None collide with the app's own set (`Ctrl+Enter`, `Ctrl+R`, `Ctrl+N`, `Ctrl+H`, `Ctrl+M`,
 * `Ctrl+L`, `Ctrl+,`).
 */
const FORMAT_BINDINGS: readonly { key: string; command: MarkdownCommandId }[] = [
  { key: 'Mod-b', command: 'bold' },
  { key: 'Mod-i', command: 'italic' },
  { key: 'Mod-e', command: 'code' },
  { key: 'Mod-Shift-x', command: 'strikethrough' },
  { key: 'Mod-1', command: 'h1' },
  { key: 'Mod-2', command: 'h2' },
  { key: 'Mod-3', command: 'h3' },
  { key: 'Mod-Shift-u', command: 'bulletList' },
  // Not `Mod-Shift-o`: Chromium claims it for its bookmark manager and it never reaches the
  // renderer, verified by the toolbar button working while the shortcut did nothing.
  { key: 'Mod-Shift-n', command: 'orderedList' },
  { key: 'Mod-Shift-t', command: 'taskList' },
  { key: 'Mod-Shift-.', command: 'quote' },
  { key: 'Mod-Shift-c', command: 'codeBlock' },
  { key: 'Mod-k', command: 'link' },
];

/**
 * App-level bindings.
 *
 * The important one is what is *absent*: `Enter` is never bound to a submit action. In a terminal
 * REPL, Enter sends and getting a newline is the awkward part; here it is the reverse, which is
 * precisely the friction this app removes. `Ctrl+Enter` is the send-ish gesture, and it only ever
 * copies.
 */
export function createAppKeymap(commands: AppCommands): Extension {
  return keymap.of([
    { key: 'Mod-Enter', run: () => run(commands.copyAndHide), preventDefault: true },
    { key: 'Mod-Shift-Enter', run: () => run(commands.copyOnly), preventDefault: true },
    { key: 'Mod-r', run: () => run(commands.rewriteDefault), preventDefault: true },
    { key: 'Mod-Shift-r', run: () => run(commands.rewritePick), preventDefault: true },
    { key: 'Mod-n', run: () => run(commands.newPrompt), preventDefault: true },
    { key: 'Mod-h', run: () => run(commands.toggleHistory), preventDefault: true },
    { key: 'Mod-m', run: () => run(commands.toggleNotes), preventDefault: true },
    { key: 'Mod-l', run: () => run(commands.togglePrompts), preventDefault: true },
    // `Mod-,` rather than a digit: the comma is unshifted on a Swiss/French layout, so it does
    // not go through the same mangling that makes `Ctrl+Shift+7` arrive as `Ctrl+/`.
    { key: 'Mod-,', run: () => run(commands.toggleSettings), preventDefault: true },
    { key: 'Mod-Shift-d', run: () => run(commands.cycleTheme), preventDefault: true },
    { key: 'Escape', run: () => run(commands.escape), preventDefault: true },

    ...FORMAT_BINDINGS.map(({ key, command }) => ({
      key,
      run: MarkdownCommands[command],
      preventDefault: true,
    })),
  ]);
}

/** Shortcut label for a formatting button's tooltip. */
export function formatShortcutLabel(command: MarkdownCommandId): string {
  const binding = FORMAT_BINDINGS.find((entry) => entry.command === command);
  if (binding === undefined) {
    return '';
  }
  return binding.key.replace('Mod', 'Ctrl').replace('Shift', 'Maj');
}

/** Runs a command and reports it as handled, so CodeMirror stops propagating the key. */
function run(command: () => void): boolean {
  command();
  return true;
}
