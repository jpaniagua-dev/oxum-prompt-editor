import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWriteFile } from '../src/main/store/atomic-write.js';
import { DraftStore } from '../src/main/store/draft-store.js';

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'oxum-draft-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('atomicWriteFile', () => {
  it('creates missing parent directories', async () => {
    const target = join(workDir, 'nested', 'deeper', 'draft.md');
    await atomicWriteFile(target, 'contenu');
    await expect(readFile(target, 'utf8')).resolves.toBe('contenu');
  });

  it('leaves no temp file behind', async () => {
    const target = join(workDir, 'draft.md');
    await atomicWriteFile(target, 'un');
    await atomicWriteFile(target, 'deux');

    const names = await readdir(workDir);
    expect(names).toEqual(['draft.md']);
    await expect(readFile(target, 'utf8')).resolves.toBe('deux');
  });

  it('never leaves the target truncated: the old content stands until the swap', async () => {
    const target = join(workDir, 'draft.md');
    await atomicWriteFile(target, 'version complète et longue');

    // Concurrent writes to the same path: whoever renames last wins, and no reader can
    // ever observe a partial file, which is the property a plain writeFile lacks.
    await Promise.all([
      atomicWriteFile(target, 'A'.repeat(5000)),
      atomicWriteFile(target, 'B'.repeat(5000)),
    ]);

    const content = await readFile(target, 'utf8');
    expect(content.length).toBe(5000);
    expect(new Set(content)).toHaveProperty('size', 1);
  });

  it('writes an empty string without erroring', async () => {
    const target = join(workDir, 'draft.md');
    await atomicWriteFile(target, '');
    await expect(readFile(target, 'utf8')).resolves.toBe('');
  });

  it('round-trips multi-byte characters and CRLF', async () => {
    const target = join(workDir, 'draft.md');
    const text = 'Réécriture — ok\r\nligne 2\n日本語 🚀';
    await atomicWriteFile(target, text);
    await expect(readFile(target, 'utf8')).resolves.toBe(text);
  });
});

describe('DraftStore', () => {
  it('reports no recovery when there is no file', async () => {
    const store = new DraftStore(join(workDir, 'draft.md'), 5);
    await expect(store.load()).resolves.toEqual({ text: '', recovered: false });
  });

  it('recovers a previously written draft', async () => {
    const path = join(workDir, 'draft.md');
    await atomicWriteFile(path, '## Mon prompt');

    const store = new DraftStore(path, 5);
    await expect(store.load()).resolves.toEqual({ text: '## Mon prompt', recovered: true });
    expect(store.peek()).toBe('## Mon prompt');
  });

  it('does not claim recovery for an empty file', async () => {
    const path = join(workDir, 'draft.md');
    await atomicWriteFile(path, '');

    const store = new DraftStore(path, 5);
    await expect(store.load()).resolves.toEqual({ text: '', recovered: false });
  });

  it('persists the newest value after the debounce', async () => {
    const path = join(workDir, 'draft.md');
    const store = new DraftStore(path, 10);

    store.update('a');
    store.update('ab');
    store.update('abc');

    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(readFile(path, 'utf8')).resolves.toBe('abc');
  });

  it('flush writes immediately without waiting for the debounce', async () => {
    const path = join(workDir, 'draft.md');
    // A long debounce stands in for "the user just typed and the app is quitting now".
    const store = new DraftStore(path, 10_000);

    store.update('texte critique');
    await store.flush();

    await expect(readFile(path, 'utf8')).resolves.toBe('texte critique');
  });

  it('flush is idempotent and skips redundant writes', async () => {
    const path = join(workDir, 'draft.md');
    const store = new DraftStore(path, 10_000);

    store.update('stable');
    await store.flush();
    await store.flush();

    await expect(readFile(path, 'utf8')).resolves.toBe('stable');
    expect(await readdir(workDir)).toEqual(['draft.md']);
  });

  it('serialises overlapping flushes so the last value wins', async () => {
    const path = join(workDir, 'draft.md');
    const store = new DraftStore(path, 10_000);

    store.update('premier');
    const first = store.flush();
    store.update('second');
    const second = store.flush();
    await Promise.all([first, second]);

    await expect(readFile(path, 'utf8')).resolves.toBe('second');
  });

  it('peek exposes unsaved text', () => {
    const store = new DraftStore(join(workDir, 'draft.md'), 10_000);
    store.update('pas encore écrit');
    expect(store.peek()).toBe('pas encore écrit');
  });
});
