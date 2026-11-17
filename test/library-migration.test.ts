import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeLibraryFolder } from '../src/main/store/library-migration.js';

let workDir = '';
let source = '';
let target = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'oxum-merge-'));
  source = join(workDir, 'prompts');
  target = join(workDir, 'notes');
  await mkdir(source);
  await mkdir(target);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function sorted(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

describe('mergeLibraryFolder', () => {
  it('moves every document under its own name and removes the emptied folder', async () => {
    await writeFile(join(source, 'revue-de-code.md'), '# Revue de code\nTu es un reviewer.');
    await writeFile(join(target, 'mail-equipe.md'), '# Mail équipe\nSalut');

    expect(await mergeLibraryFolder(source, target)).toEqual({ moved: 1, failed: 0 });
    expect(await sorted(target)).toEqual(['mail-equipe.md', 'revue-de-code.md']);
    expect(await readFile(join(target, 'revue-de-code.md'), 'utf8')).toBe(
      '# Revue de code\nTu es un reviewer.',
    );
    await expect(readdir(source)).rejects.toThrow();
  });

  it('keeps the modification time, so a moved document keeps its place', async () => {
    const path = join(source, 'ancien.md');
    await writeFile(path, '# Ancien\nx');
    const written = new Date('2026-01-15T10:00:00Z');
    await utimes(path, written, written);

    await mergeLibraryFolder(source, target);

    expect((await stat(join(target, 'ancien.md'))).mtime.getTime()).toBe(written.getTime());
  });

  it('suffixes a name already taken by a different document', async () => {
    await writeFile(join(source, 'points.md'), '# Points\nprompt');
    await writeFile(join(target, 'points.md'), '# Points\nnote');

    await mergeLibraryFolder(source, target);

    expect(await sorted(target)).toEqual(['points-2.md', 'points.md']);
    expect(await readFile(join(target, 'points.md'), 'utf8')).toBe('# Points\nnote');
    expect(await readFile(join(target, 'points-2.md'), 'utf8')).toBe('# Points\nprompt');
  });

  it('does not duplicate a document already copied by an interrupted run', async () => {
    // A crash between the write and the delete leaves the document in both folders. Rerunning
    // must recognise the copy, here under a suffixed name, instead of writing a third one.
    await writeFile(join(target, 'points.md'), '# Points\nnote');
    await writeFile(join(target, 'points-2.md'), '# Points\nprompt');
    await writeFile(join(source, 'points.md'), '# Points\nprompt');

    expect(await mergeLibraryFolder(source, target)).toEqual({ moved: 1, failed: 0 });
    expect(await sorted(target)).toEqual(['points-2.md', 'points.md']);
  });

  it('does nothing when both settings point at the same folder', async () => {
    // Without the guard, every file would be found "already present with the same content", and
    // deleting the source would delete the only copy.
    await writeFile(join(target, 'unique.md'), '# Unique\nseule copie');

    expect(await mergeLibraryFolder(target, target)).toEqual({ moved: 0, failed: 0 });
    expect(await readFile(join(target, 'unique.md'), 'utf8')).toBe('# Unique\nseule copie');
  });

  it('does nothing when the source folder does not exist', async () => {
    expect(await mergeLibraryFolder(join(workDir, 'absent'), target)).toEqual({
      moved: 0,
      failed: 0,
    });
    expect(await readdir(target)).toEqual([]);
  });

  it('leaves files the library never claimed, and their folder', async () => {
    await writeFile(join(source, 'Notes Perso.md'), 'pas à moi');
    await writeFile(join(source, 'todo.txt'), 'pas à moi');
    await writeFile(join(source, 'mien.md'), '# Mien\nx');

    await mergeLibraryFolder(source, target);

    expect(await sorted(source)).toEqual(['Notes Perso.md', 'todo.txt']);
    expect(await readdir(target)).toEqual(['mien.md']);
  });

  it('creates the target folder when it does not exist yet', async () => {
    const fresh = join(workDir, 'library');
    await writeFile(join(source, 'mien.md'), '# Mien\nx');

    await mergeLibraryFolder(source, fresh);

    expect(await readdir(fresh)).toEqual(['mien.md']);
  });
});
