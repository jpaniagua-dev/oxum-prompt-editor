import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { LibraryEntry } from '@shared/contracts.js';
import { atomicWriteFile, ensureDirectory } from './atomic-write.js';
import { firstMeaningfulLine } from './history-store.js';

/**
 * Names this store recognises as its own.
 *
 * Deliberately narrow: lowercase letters, digits and hyphens, then `.md`. With no dot, no dot-dot
 * and no separator able to match, an id coming back from the renderer cannot escape the store
 * directory. That guard matters more here than in the history store, because this directory is
 * configurable and may sit anywhere on the disk, next to files the app knows nothing about.
 *
 * The flip side is that a `.md` the user wrote by hand shows up in the list only if it happens to
 * fit this shape. That is the intended trade: pointing the setting at an existing folder must not
 * make the app claim everything in it.
 */
const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.md$/;

/**
 * A folder of Markdown documents the user deliberately kept, under names they can read.
 *
 * Instantiated once per library (see `LibraryId`): the notes they write, and the prompts they
 * reuse. Same mechanics, different folders, so the class carries no idea of which one it serves.
 *
 * Two properties separate it from `HistoryStore`, and both are load-bearing:
 *
 * - **Nothing is ever pruned.** A snapshot is automatic, so discarding the oldest is a
 *   housekeeping detail. A saved document was an explicit act, so silently dropping one because
 *   there are many would be the exact data loss this app exists to prevent.
 * - **The file name is the title, slugified.** The directory is configurable and therefore
 *   browsable, possibly synced or versioned, so `revue-de-code-angular.md` is worth the slug
 *   logic that `20260819T142233123.md` would not need.
 *
 * The directory is resolved through a callback on every call rather than captured once: the
 * setting can change while the app runs, and a store holding a stale path would keep writing to
 * the old folder while the UI listed the new one.
 */
export class LibraryStore {
  constructor(private readonly directory: () => string) {}

  /**
   * Writes `text` to a new document named after its first meaningful line.
   *
   * @returns The created entry, whose `id` may carry a `-2` suffix if the name was taken.
   * @throws When the text is blank: an untitled empty document is never what the user meant.
   */
  async save(text: string): Promise<LibraryEntry> {
    if (text.trim().length === 0) {
      throw new Error('Cannot save an empty document');
    }
    const directory = await ensureDirectory(this.directory());
    const taken = new Set(await this.listNoteFiles());
    const id = uniqueId(slugify(firstMeaningfulLine(text, 60)), taken);

    await atomicWriteFile(join(directory, id), text);
    return this.describe(id, text);
  }

  /**
   * Replaces the content of an existing document, keeping its name.
   *
   * The name is deliberately not re-derived from the new text: the id is what the renderer holds
   * and what the user sees in their folder, so an update must not silently rename the file and
   * leave the old one behind.
   */
  async overwrite(id: string, text: string): Promise<LibraryEntry> {
    if (text.trim().length === 0) {
      throw new Error('Cannot save an empty document');
    }
    const directory = await ensureDirectory(this.directory());
    await atomicWriteFile(join(directory, this.assertId(id)), text);
    return this.describe(id, text);
  }

  /** Lists documents, most recently written first. Unreadable or foreign files are ignored. */
  async list(): Promise<LibraryEntry[]> {
    const names = await this.listNoteFiles();
    const directory = this.directory();
    const entries = await Promise.all(
      names.map(async (name): Promise<LibraryEntry | null> => {
        try {
          const path = join(directory, name);
          const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
          return {
            id: name,
            title: firstMeaningfulLine(text),
            updatedAt: stats.mtime.toISOString(),
            size: text.length,
          };
        } catch {
          return null;
        }
      }),
    );

    return entries
      .filter((entry): entry is LibraryEntry => entry !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Reads one document by id. Throws when the id is unknown or malformed. */
  async read(id: string): Promise<string> {
    return readFile(join(this.directory(), this.assertId(id)), 'utf8');
  }

  /** Deletes one document. The only deletion in this store, and always user-initiated. */
  async delete(id: string): Promise<void> {
    await unlink(join(this.directory(), this.assertId(id)));
  }

  /** Document file names, sorted by name. Order is redone by `list()` on the write time. */
  private async listNoteFiles(): Promise<string[]> {
    try {
      const names = await readdir(this.directory());
      return names.filter((name) => DOCUMENT_ID_PATTERN.test(name)).sort();
    } catch {
      // The directory not existing yet is the normal state before the first save, and a path
      // the user just typed may not exist at all. Neither is worth an error to the renderer.
      return [];
    }
  }

  /** Rejects anything that is not a generated name, which is what blocks path traversal. */
  private assertId(id: string): string {
    if (!DOCUMENT_ID_PATTERN.test(id)) {
      throw new Error(`Invalid document id: ${id}`);
    }
    return id;
  }

  private describe(id: string, text: string): LibraryEntry {
    return {
      id,
      title: firstMeaningfulLine(text),
      updatedAt: new Date().toISOString(),
      size: text.length,
    };
  }
}

/**
 * Turns a title into a file name stem.
 *
 * The `NFD` pass then the diacritic strip is what keeps French titles readable: without it
 * "Réécriture d'un ticket" would lose its accented letters entirely and come out as
 * `r-criture-d-un-ticket`. Exported for testing, since every file name depends on it.
 */
export function slugify(title: string, maxLength = 60): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');

  // A title made only of punctuation or of a non-Latin script leaves nothing behind. A generic
  // stem keeps the document saveable; the collision suffix then makes it unique.
  // French because the user browses this folder: the file name is user-facing.
  return slug.length > 0 ? slug : 'sans-titre';
}

/** Appends `-2`, `-3`, … until the name is free, so saving twice never overwrites. */
function uniqueId(stem: string, taken: ReadonlySet<string>): string {
  if (!taken.has(`${stem}.md`)) {
    return `${stem}.md`;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}.md`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
