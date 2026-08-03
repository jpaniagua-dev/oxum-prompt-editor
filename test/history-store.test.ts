import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HistoryStore,
  firstMeaningfulLine,
  fromCompactTimestamp,
  toCompactTimestamp,
} from '../src/main/store/history-store.js';

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'oxum-history-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Distinct timestamps so ordering assertions are unambiguous. */
function at(minute: number): Date {
  return new Date(`2026-08-03T10:${String(minute).padStart(2, '0')}:00.000Z`);
}

describe('timestamp helpers', () => {
  it('produces a lexicographically sortable stamp', () => {
    expect(toCompactTimestamp(new Date('2026-08-03T14:05:09.123Z'))).toBe('20260803T140509123');
    expect(toCompactTimestamp(at(1)) < toCompactTimestamp(at(2))).toBe(true);
  });

  it('round-trips', () => {
    const date = new Date('2026-12-31T23:59:58.007Z');
    expect(fromCompactTimestamp(toCompactTimestamp(date)).toISOString()).toBe(date.toISOString());
  });
});

describe('firstMeaningfulLine', () => {
  it('skips blank lines and strips heading marks', () => {
    expect(firstMeaningfulLine('\n\n### Mon titre\ncorps')).toBe('Mon titre');
  });

  it('falls back for empty text', () => {
    expect(firstMeaningfulLine('   \n\n')).toBe('(vide)');
  });

  it('truncates long lines', () => {
    expect(firstMeaningfulLine('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('HistoryStore', () => {
  it('refuses to archive blank text', async () => {
    const store = new HistoryStore(workDir);
    await expect(store.snapshot('   \n ', 'copy', at(1))).resolves.toBeNull();
    await expect(readdir(workDir)).resolves.toEqual([]);
  });

  it('archives and reads back byte-identical content', async () => {
    const store = new HistoryStore(workDir);
    const text = '## Prompt\n\n```ts\nconst x = 1;\n```\n';

    const id = await store.snapshot(text, 'copy', at(1));
    expect(id).not.toBeNull();
    await expect(store.read(id as string)).resolves.toBe(text);
  });

  it('lists entries newest first with their reason and title', async () => {
    const store = new HistoryStore(workDir);
    await store.snapshot('# Ancien', 'copy', at(1));
    await store.snapshot('# Récent', 'rewrite', at(2));

    const entries = await store.list();
    expect(entries.map((entry) => entry.title)).toEqual(['Récent', 'Ancien']);
    expect(entries[0]?.reason).toBe('rewrite');
    expect(entries[0]?.savedAt).toBe(at(2).toISOString());
  });

  it('prunes the oldest entries beyond the cap', async () => {
    const store = new HistoryStore(workDir, 3);
    for (let minute = 1; minute <= 5; minute += 1) {
      await store.snapshot(`# n${minute}`, 'copy', at(minute));
    }

    const entries = await store.list();
    expect(entries).toHaveLength(3);
    // The three most recent survive; pruning removes from the oldest end only.
    expect(entries.map((entry) => entry.title)).toEqual(['n5', 'n4', 'n3']);
  });

  it('ignores foreign files in the directory', async () => {
    const store = new HistoryStore(workDir);
    await store.snapshot('# Vrai', 'copy', at(1));
    await writeFile(join(workDir, 'notes.txt'), 'sans rapport', 'utf8');
    await writeFile(join(workDir, 'README.md'), 'sans rapport', 'utf8');

    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Vrai');
  });

  it('returns an empty list when the directory does not exist yet', async () => {
    const store = new HistoryStore(join(workDir, 'absent'));
    await expect(store.list()).resolves.toEqual([]);
  });

  it('rejects ids that are not generated names, blocking path traversal', async () => {
    const store = new HistoryStore(workDir);
    await expect(store.read('../../settings.json')).rejects.toThrow('Invalid history id');
    await expect(store.read('draft.md')).rejects.toThrow('Invalid history id');
  });
});
