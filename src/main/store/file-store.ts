import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { ExternalFile, OpenedFile } from '@shared/contracts.js';
import { atomicWriteFile } from './atomic-write.js';
import { firstMeaningfulLine } from './history-store.js';
import { slugify } from './library-store.js';

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
  /** Native save dialog, seeded with `suggestedName`. Null when cancelled. */
  chooseToSave: (suggestedName: string) => Promise<string | null>;
}

/**
 * Markdown files the user opened from anywhere on the disk.
 *
 * The whole point of this class is the {@link authorised} set. Every other store in the app
 * owns its directory and derives file names itself, so a renderer request can be validated by
 * shape alone. Here the destination is an arbitrary absolute path, and no pattern can tell a
 * legitimate one from `C:\Windows\System32\drivers\etc\hosts`. So the rule is not "does
 * this path look safe" but "did the user pick this exact path in a native dialog": `save` only
 * ever writes to a path `open` or `saveAs` handed out earlier in this run.
 *
 * The set is deliberately not persisted. An authorisation is a thing the user granted in a
 * session, and reviving it days later — silently, on a draft they may have rewritten since —
 * would turn `Ctrl+S` into an overwrite of a file they had forgotten about. After a restart the
 * draft is still there and `Ctrl+S` falls back to the save dialog, which is one extra click and
 * no surprise.
 */
export class FileStore {
  private readonly authorised = new Set<string>();

  constructor(private readonly prompts: FilePrompts) {}

  /**
   * Asks the user for a file, reads it, and authorises later writes to it.
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
    this.authorised.add(path);
    return { path, name: basename(path), text };
  }

  /**
   * Writes `text` to a path the user chose earlier in this run.
   *
   * @throws When the path was never handed out by {@link open} or {@link saveAs}, which is the
   * guard that keeps the renderer from naming a destination of its own.
   */
  async save(path: string, text: string): Promise<ExternalFile> {
    const target = resolve(path);
    if (!this.authorised.has(target)) {
      // Developer-facing: the renderer only ever echoes back a path this store handed it, so
      // reaching this line means a bug, not a situation the user can talk themselves into.
      throw new Error(`Unauthorised file path: ${target}`);
    }
    await atomicWriteFile(target, text);
    return { path: target, name: basename(target) };
  }

  /**
   * Asks the user where to write, writes there, and authorises later saves to that path.
   *
   * The dialog is seeded with the same slug the library would have given the document, so the
   * naming rule the user already sees in the notes folder does not change just because the file
   * is going somewhere else.
   *
   * @returns The written file, or null when the dialog was cancelled.
   */
  async saveAs(text: string): Promise<ExternalFile | null> {
    const chosen = await this.prompts.chooseToSave(`${slugify(firstMeaningfulLine(text, 60))}.md`);
    if (chosen === null) {
      return null;
    }
    const target = resolve(chosen);
    await atomicWriteFile(target, text);
    this.authorised.add(target);
    return { path: target, name: basename(target) };
  }
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} Mo`;
}
