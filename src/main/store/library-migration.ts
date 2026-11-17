import { readFile, readdir, realpath, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile, ensureDirectory } from './atomic-write.js';
import { DOCUMENT_ID_PATTERN, uniqueId } from './library-store.js';

/** What a merge did, for the log line. */
export interface MergeReport {
  readonly moved: number;
  readonly failed: number;
}

/**
 * Moves every library document of `source` into `target`, one file at a time.
 *
 * Exists for the merge of the former prompts folder into the library. Moving files is the risk
 * the app otherwise refuses, so each document is copied, read back and compared before its source
 * is deleted: at no point does a document exist nowhere. A crash between the write and the
 * delete leaves two copies, and the next run recognises the copy by its content instead of
 * writing a third. A file that fails stays where it was and is retried at the next start.
 *
 * The copy keeps the source's modification time: the library is ordered by it, and a fresh one
 * would put every migrated document above everything written before.
 *
 * Never throws: a failed migration must not stop the app from starting.
 */
export async function mergeLibraryFolder(source: string, target: string): Promise<MergeReport> {
  let moved = 0;
  let failed = 0;
  try {
    const sourceDir = await realpathOrNull(source);
    if (sourceDir === null) {
      return { moved, failed };
    }
    const targetDir = await realpath(await ensureDirectory(target));
    // The same folder reached twice (identical settings, or a junction) would find every file
    // "already present with the same content" and delete it: the only copy.
    if (sameDirectory(sourceDir, targetDir)) {
      return { moved, failed };
    }

    const names = (await readdir(sourceDir)).filter((name) => DOCUMENT_ID_PATTERN.test(name));
    for (const name of names) {
      try {
        await moveDocument(sourceDir, targetDir, name);
        moved += 1;
      } catch (error) {
        failed += 1;
        console.error('[library-migration] could not move', name, error);
      }
    }

    // Only succeeds once the folder is empty: files the library never claimed keep it alive.
    await rmdir(sourceDir).catch(() => undefined);
  } catch (error) {
    console.error('[library-migration] merge aborted', error);
  }
  return { moved, failed };
}

async function moveDocument(sourceDir: string, targetDir: string, name: string): Promise<void> {
  const sourcePath = join(sourceDir, name);
  const [text, stats] = await Promise.all([readFile(sourcePath, 'utf8'), stat(sourcePath)]);
  const taken = new Set(
    (await readdir(targetDir)).filter((file) => DOCUMENT_ID_PATTERN.test(file)),
  );

  const stem = name.slice(0, -'.md'.length);
  const alreadyCopied = await findSameContent(targetDir, stem, taken, text);
  if (!alreadyCopied) {
    const targetPath = join(targetDir, uniqueId(stem, taken));
    await atomicWriteFile(targetPath, text);
    if ((await readFile(targetPath, 'utf8')) !== text) {
      throw new Error(`Copy of ${name} does not match its source`);
    }
    await utimes(targetPath, stats.atime, stats.mtime);
  }
  await unlink(sourcePath);
}

/** Whether `stem.md` or one of its `stem-N.md` siblings already holds exactly `text`. */
async function findSameContent(
  directory: string,
  stem: string,
  taken: ReadonlySet<string>,
  text: string,
): Promise<boolean> {
  const sibling = new RegExp(`^${stem}(?:-\\d+)?\\.md$`);
  for (const name of taken) {
    if (sibling.test(name) && (await readFile(join(directory, name), 'utf8')) === text) {
      return true;
    }
  }
  return false;
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** Windows paths are case-insensitive, so two spellings of one folder must compare equal. */
function sameDirectory(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
