import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

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
  /** Close the open panel, or hide the window when there is none. */
  escape: () => void;
}

/**
 * App-level bindings.
 *
 * The important one is what is *absent*: `Enter` is never bound to a submit action. In a
 * terminal REPL, Enter sends and getting a newline is the awkward part; here it is the
 * reverse, which is precisely the friction this app removes. `Ctrl+Enter` is the send-ish
 * gesture, and it only ever copies.
 */
export function createAppKeymap(commands: AppCommands): Extension {
  return keymap.of([
    { key: 'Mod-Enter', run: () => run(commands.copyAndHide), preventDefault: true },
    { key: 'Mod-Shift-Enter', run: () => run(commands.copyOnly), preventDefault: true },
    { key: 'Mod-r', run: () => run(commands.rewriteDefault), preventDefault: true },
    { key: 'Mod-Shift-r', run: () => run(commands.rewritePick), preventDefault: true },
    { key: 'Mod-n', run: () => run(commands.newPrompt), preventDefault: true },
    { key: 'Mod-h', run: () => run(commands.toggleHistory), preventDefault: true },
    { key: 'Escape', run: () => run(commands.escape), preventDefault: true },
  ]);
}

/** Runs a command and reports it as handled, so CodeMirror stops propagating the key. */
function run(command: () => void): boolean {
  command();
  return true;
}
