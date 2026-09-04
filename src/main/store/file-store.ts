import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { OpenedFile } from '@shared/contracts.js';

/**
 * Refuses to load anything the editor could not usefully hold.
 *
 * CodeMirror keeps the whole document in memory and re-parses it on every keystroke; a
 * multi-megabyte file turns the popup into a frozen window with no way back. Failing with a
 * readable message beats a hang the user can only escape by killing the app.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The dialogs this store needs, injected so the store itself stays free of Electron. */
export interface FilePrompts {
  /** Native open dialog. Returns the chosen absolute path, or null when cancelled. */
  chooseToOpen: () => Promise<string | null>;
}

/**
 * Markdown files the user opened from anywhere on the disk, read-only.
 *
 * Read-only by design, and it is the one store in the app that writes nothing. Every other one
 * owns its directory and derives file names itself, so a renderer request can be validated by
 * shape alone; here the target is an arbitrary absolute path, and no pattern tells a legitimate
 * one from `C:\Windows\System32\drivers\etc\hosts`. Writing back would therefore need the main
 * process to track which paths the user authorised in a native dialog — real machinery for a
 * capability the app does not need: what it produces is text to copy out, kept in the draft and
 * in the two libraries. Opening a file is a way to get a document *into* that flow, not to
 * become its editor.
 */
export class FileStore {
  constructor(private readonly prompts: FilePrompts) {}

  /**
   * Asks the user for a file and reads it.
   *
   * No extension check: the dialog filter already steers towards `.md`, and a Markdown document
   * saved as `.txt` is still one. The user picking a file *is* the decision.
   *
   * @returns The file with its content, or null when the dialog was cancelled.
   * @throws When the file is unreadable or larger than {@link MAX_FILE_BYTES}.
   */
  async open(): Promise<OpenedFile | null> {
    const chosen = await this.prompts.chooseToOpen();
    if (chosen === null) {
      return null;
    }
    const path = resolve(chosen);

    const stats = await stat(path);
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error(
        `Fichier trop volumineux (${formatSize(stats.size)}, maximum ${formatSize(MAX_FILE_BYTES)})`,
      );
    }

    const text = await readFile(path, 'utf8');
    return { path, name: basename(path), text };
  }
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} Mo`;
}
