import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FileStore } from '../src/main/store/file-store.js';

let directory = '';

interface ScriptedStore {
  readonly store: FileStore;
  /** Kept so a test can assert on the name the dialog was seeded with. */
  readonly chooseToSave: Mock<(suggestedName: string) => Promise<string | null>>;
}

/** A store whose dialogs are scripted, so the tests never open a native window. */
function storeThatPicks(toOpen: string | null, toSave: string | null = null): ScriptedStore {
  const chooseToSave: ScriptedStore['chooseToSave'] = vi.fn(async () => toSave);
  const store = new FileStore({
    chooseToOpen: async () => toOpen,
    chooseToSave,
  });
  return { store, chooseToSave };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oxum-files-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('FileStore', () => {
  it('reads the file the user picked and reports its name', async () => {
    const path = join(directory, 'notes.md');
    await writeFile(path, '# Titre\n', 'utf8');

    const opened = await storeThatPicks(path).store.open();

    expect(opened).toEqual({ path, name: 'notes.md', text: '# Titre\n' });
  });

  it('returns null when the open dialog is cancelled', async () => {
    expect(await storeThatPicks(null).store.open()).toBeNull();
  });

  it('refuses a file too large for the editor to hold', async () => {
    const path = join(directory, 'enorme.md');
    await writeFile(path, 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8');

    await expect(storeThatPicks(path).store.open()).rejects.toThrow(/trop volumineux/i);
  });

  describe('authorisation', () => {
    it('writes back to a path the user opened in this session', async () => {
      const path = join(directory, 'notes.md');
      await writeFile(path, 'avant', 'utf8');

      const { store } = storeThatPicks(path);
      await store.open();
      const saved = await store.save(path, 'après');

      expect(saved).toEqual({ path, name: 'notes.md' });
      expect(await readFile(path, 'utf8')).toBe('après');
    });

    it('refuses a path no dialog ever handed out', async () => {
      const path = join(directory, 'jamais-ouvert.md');
      await writeFile(path, 'intact', 'utf8');

      const { store } = storeThatPicks(null);

      await expect(store.save(path, 'écrasé')).rejects.toThrow(/unauthorised/i);
      expect(await readFile(path, 'utf8')).toBe('intact');
    });

    it('does not let one authorised path authorise its neighbours', async () => {
      const opened = join(directory, 'notes.md');
      const sibling = join(directory, 'autre.md');
      await writeFile(opened, 'a', 'utf8');
      await writeFile(sibling, 'intact', 'utf8');

      const { store } = storeThatPicks(opened);
      await store.open();

      await expect(store.save(sibling, 'écrasé')).rejects.toThrow(/unauthorised/i);
      expect(await readFile(sibling, 'utf8')).toBe('intact');
    });

    it('refuses a traversal dressed up as a relative path from an authorised one', async () => {
      const opened = join(directory, 'notes.md');
      await writeFile(opened, 'a', 'utf8');

      const { store } = storeThatPicks(opened);
      await store.open();

      await expect(store.save(join(directory, 'sous', '..', 'ailleurs.md'), 'x')).rejects.toThrow(
        /unauthorised/i,
      );
    });

    it('authorises the destination chosen through save-as, for later saves', async () => {
      const target = join(directory, 'nouveau.md');
      const { store } = storeThatPicks(null, target);

      const first = await store.saveAs('# Une note de réunion\n');
      expect(first).toEqual({ path: target, name: 'nouveau.md' });

      await store.save(target, 'suite');
      expect(await readFile(target, 'utf8')).toBe('suite');
    });
  });

  it('seeds the save dialog with the slug the library would have used', async () => {
    const { store, chooseToSave } = storeThatPicks(null, join(directory, 'x.md'));

    await store.saveAs('# Réunion du lundi\n\nDu contenu.');

    expect(chooseToSave).toHaveBeenCalledWith('reunion-du-lundi.md');
  });

  it('returns null when the save dialog is cancelled', async () => {
    expect(await storeThatPicks(null, null).store.saveAs('du texte')).toBeNull();
  });
});
