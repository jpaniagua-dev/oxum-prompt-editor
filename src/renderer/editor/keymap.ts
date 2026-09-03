import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { MarkdownCommands } from './markdown-commands.js';
import { APP_SHORTCUTS, FORMAT_SHORTCUTS, type AppCommandId } from './shortcuts.js';

/**
 * The app's own commands, one per {@link AppCommandId}.
 *
 * A `Record` rather than a hand-written interface: the keys are the very ids the shortcut table
 * declares, so a binding added there without an implementation here is a compile error rather
 * than a key that silently does nothing.
 */
export type AppCommands = Record<AppCommandId, () => void>;

/**
 * Builds the app keymap from the shortcut catalogue.
 *
 * Nothing here decides which key does what: {@link APP_SHORTCUTS} and {@link FORMAT_SHORTCUTS}
 * do, and the help panel reads the same tables. Installed under `Prec.highest()` by the caller,
 * without which `searchKeymap` wins on the bindings it shares.
 */
export function createAppKeymap(commands: AppCommands): Extension {
  return keymap.of([
    ...APP_SHORTCUTS.map(({ key, command }) => ({
      key,
      run: () => run(commands[command]),
      preventDefault: true,
    })),
    ...FORMAT_SHORTCUTS.map(({ key, command }) => ({
      key,
      run: MarkdownCommands[command],
      preventDefault: true,
    })),
  ]);
}

/** Runs a command and reports it as handled, so CodeMirror stops propagating the key. */
function run(command: () => void): boolean {
  command();
  return true;
}
