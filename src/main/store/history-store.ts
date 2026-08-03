import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry, SnapshotReason } from '@shared/contracts.js';
import { atomicWriteFile, ensureDirectory } from './atomic-write.js';

/** Snapshots kept on disk before the oldest are pruned. */
const MAX_ENTRIES = 200;

const FILE_PATTERN = /^(\d{8}T\d{6}\d{0,3})-([a-z]+)\.md$/;

/**
 * Append-only archive of past drafts.
 *
 * Snapshots are taken at every point where text could otherwise be lost: before a
 * clear, before a rewrite is applied, on copy, and on quit. Nothing in the app deletes
 * a snapshot except the size-based pruning here.
 */
export class HistoryStore {
  constructor(
    private readonly directory: string,
    private readonly maxEntries: number = MAX_ENTRIES,
  ) {}

  /**
   * Archives `text` under a sortable timestamped name.
   *
   * @param takenAt Injected rather than read from the clock so the behaviour is testable.
   * @returns The snapshot id, or null when the text was empty and not worth archiving.
   */
  async snapshot(text: string, reason: SnapshotReason, takenAt: Date): Promise<string | null> {
    if (text.trim().length === 0) {
      return null;
    }

    await ensureDirectory(this.directory);
    const id = `${toCompactTimestamp(takenAt)}-${reason}.md`;
    await atomicWriteFile(join(this.directory, id), text);
    await this.prune();
    return id;
  }

  /** Lists snapshots, newest first. Unreadable or foreign files are ignored. */
  async list(): Promise<HistoryEntry[]> {
    const names = await this.listSnapshotFiles();
    const entries = await Promise.all(
      names.map(async (name): Promise<HistoryEntry | null> => {
        const match = FILE_PATTERN.exec(name);
        if (match === null) {
          return null;
        }
        try {
          const text = await readFile(join(this.directory, name), 'utf8');
          return {
            id: name,
            savedAt: fromCompactTimestamp(match[1] ?? '').toISOString(),
            reason: (match[2] ?? 'manual') as SnapshotReason,
            title: firstMeaningfulLine(text),
            size: text.length,
          };
        } catch {
          return null;
        }
      }),
    );

    return entries.filter((entry): entry is HistoryEntry => entry !== null).reverse();
  }

  /** Reads one snapshot by id. Throws when the id is unknown or malformed. */
  async read(id: string): Promise<string> {
    if (FILE_PATTERN.exec(id) === null) {
      // Rejecting anything that is not a generated name keeps this immune to path traversal
      // even though the id only ever comes from our own list().
      throw new Error(`Invalid history id: ${id}`);
    }
    return readFile(join(this.directory, id), 'utf8');
  }

  /** Deletes the oldest snapshots beyond `maxEntries`. */
  private async prune(): Promise<void> {
    const names = await this.listSnapshotFiles();
    const excess = names.length - this.maxEntries;
    if (excess <= 0) {
      return;
    }
    await Promise.all(
      names.slice(0, excess).map(async (name) => {
        try {
          await unlink(join(this.directory, name));
        } catch (error) {
          console.error('[history-store] failed to prune snapshot', name, error);
        }
      }),
    );
  }

  /** Snapshot file names in ascending (oldest first) order. */
  private async listSnapshotFiles(): Promise<string[]> {
    try {
      const names = await readdir(this.directory);
      return names.filter((name) => FILE_PATTERN.test(name)).sort();
    } catch {
      return [];
    }
  }
}

/** `2026-08-03T14:05:09.123Z` becomes `20260803T140509123`, which sorts chronologically. */
export function toCompactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '').replace(/Z$/, '');
}

/** Inverse of {@link toCompactTimestamp}. */
export function fromCompactTimestamp(compact: string): Date {
  const year = compact.slice(0, 4);
  const month = compact.slice(4, 6);
  const day = compact.slice(6, 8);
  const hour = compact.slice(9, 11);
  const minute = compact.slice(11, 13);
  const second = compact.slice(13, 15);
  const millis = compact.slice(15, 18) || '000';
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`);
}

/** Picks a display title: the first non-empty line, stripped of Markdown heading marks. */
export function firstMeaningfulLine(text: string, maxLength = 80): string {
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(/^#{1,6}\s*/, '').trim())
    .find((candidate) => candidate.length > 0);

  if (line === undefined) {
    return '(vide)';
  }
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
