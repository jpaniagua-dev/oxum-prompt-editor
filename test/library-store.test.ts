import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryStore, slugify } from '../src/main/store/library-store.js';

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'oxum-notes-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** A store pointed at the temp directory, through the resolver the real app uses. */
function storeAt(directory: string = workDir): LibraryStore {
  return new LibraryStore(() => directory);
}

describe('slugify', () => {
  it('strips diacritics instead of dropping the letters', () => {
    // Without the NFD pass the accented letters would vanish entirely and the name would come
    // out as `r-criture-d-un-ticket`, which is unreadable in a folder the user browses.
    expect(slugify('Réécriture d’un ticket')).toBe('reecriture-d-un-ticket');
    expect(slugify('Où déployer ça ?')).toBe('ou-deployer-ca');
  });

  it('collapses punctuation and trims the edges', () => {
    expect(slugify('  ## Revue de code : Angular 21 !  ')).toBe('revue-de-code-angular-21');
  });

  it('falls back to a generic stem when nothing survives', () => {
    // A title made only of punctuation, or written in a non-Latin script, leaves an empty slug.
    // Refusing to save would be worse than a generic name the collision suffix makes unique.
    expect(slugify('!!! ???')).toBe('sans-titre');
    expect(slugify('日本語')).toBe('sans-titre');
  });

  it('never ends on a hyphen after truncation', () => {
    expect(slugify('abcde fghij', 6)).toBe('abcde');
  });
});

describe('LibraryStore', () => {
  it('names the file after the first meaningful line', async () => {
    const entry = await storeAt().save('# Revue de code Angular\n\nDes détails.');

    expect(entry.id).toBe('revue-de-code-angular.md');
    expect(entry.title).toBe('Revue de code Angular');
    expect(await readdir(workDir)).toEqual(['revue-de-code-angular.md']);
  });

  it('reads back byte-identical content', async () => {
    const text = '# Titre\n\n```ts\nconst a = 1;\n```\n\n  indenté\n\n';
    const store = storeAt();
    const entry = await store.save(text);

    expect(await store.read(entry.id)).toBe(text);
  });

  it('suffixes instead of overwriting when the name is taken', async () => {
    const store = storeAt();
    const first = await store.save('# Mon prompt\nun');
    const second = await store.save('# Mon prompt\ndeux');
    const third = await store.save('# Mon prompt\ntrois');

    expect([first.id, second.id, third.id]).toEqual([
      'mon-prompt.md',
      'mon-prompt-2.md',
      'mon-prompt-3.md',
    ]);
    // The point of the suffix: saving twice must never cost the first note.
    expect(await store.read(first.id)).toBe('# Mon prompt\nun');
  });

  it('keeps the name when overwriting, rather than renaming the file', async () => {
    // The id is what the renderer holds and what the user sees in their folder. Re-deriving it
    // from the new text would leave the old file behind under the old name.
    const store = storeAt();
    const created = await store.save('# Ancien titre\ncorps');
    const updated = await store.overwrite(created.id, '# Nouveau titre\ncorps');

    expect(updated.id).toBe('ancien-titre.md');
    expect(updated.title).toBe('Nouveau titre');
    expect(await readdir(workDir)).toEqual(['ancien-titre.md']);
  });

  it('refuses to save blank text', async () => {
    const store = storeAt();
    await expect(store.save('   \n\n')).rejects.toThrow('empty document');
    await expect(store.overwrite('quoi.md', '')).rejects.toThrow('empty document');
  });

  it('lists most recently written first', async () => {
    const store = storeAt();
    await store.save('# Ancienne\nx');
    await store.save('# Recente\nx');
    // mtime is the ordering key, so the second write has to actually be later.
    await store.overwrite('ancienne.md', '# Ancienne\ny');

    expect((await store.list()).map((entry) => entry.id)).toEqual([
      'ancienne.md',
      'recente.md',
    ]);
  });

  it('deletes one document and leaves the others', async () => {
    const store = storeAt();
    await store.save('# Une\nx');
    await store.save('# Deux\nx');
    await store.delete('une.md');

    expect((await store.list()).map((entry) => entry.id)).toEqual(['deux.md']);
  });

  it('rejects ids outside its own naming, blocking path traversal', async () => {
    // Matters more than in the history store: this directory is configurable, so it can sit
    // anywhere, including next to files that have nothing to do with the app.
    const store = storeAt();
    for (const id of ['../draft.md', '..\\draft.md', '/etc/passwd', 'Note.md', 'note.txt', '.md']) {
      await expect(store.read(id)).rejects.toThrow('Invalid document id');
      await expect(store.delete(id)).rejects.toThrow('Invalid document id');
    }
  });

  it('ignores files that are not its own', async () => {
    // Pointing the setting at an existing folder must not make the app claim what is in it.
    const store = storeAt();
    await store.save('# Mienne\nx');
    await writeFile(join(workDir, 'Notes Perso.md'), 'pas a moi');
    await writeFile(join(workDir, 'todo.txt'), 'pas a moi');

    expect((await store.list()).map((entry) => entry.id)).toEqual(['mienne.md']);
  });

  it('returns an empty list for a directory that does not exist', async () => {
    // Normal before the first note, and normal for a path the user just typed.
    expect(await storeAt(join(workDir, 'pas-encore')).list()).toEqual([]);
  });

  it('follows the resolver when the configured directory changes', async () => {
    // The whole reason the directory is a callback: the setting can change while the app runs.
    let current = join(workDir, 'a');
    const store = new LibraryStore(() => current);
    await store.save('# Dans A\nx');

    current = join(workDir, 'b');
    expect(await store.list()).toEqual([]);

    await store.save('# Dans B\nx');
    expect((await store.list()).map((entry) => entry.id)).toEqual(['dans-b.md']);

    // And the notes in the old folder are untouched, which is what "changing the folder does not
    // move anything" means in practice.
    expect(await readFile(join(workDir, 'a', 'dans-a.md'), 'utf8')).toBe('# Dans A\nx');
  });

  it('keeps two libraries independent, even on the same class', async () => {
    // Notes and prompts are the same store pointed at two folders. The property that makes that
    // safe is that neither ever sees the other's files: saving a prompt must not surface in the
    // notes list, and deleting one must not reach across.
    const notes = storeAt(join(workDir, 'notes'));
    const prompts = storeAt(join(workDir, 'prompts'));

    await notes.save('# Une note\nx');
    await prompts.save('# Un prompt\nx');

    expect((await notes.list()).map((entry) => entry.id)).toEqual(['une-note.md']);
    expect((await prompts.list()).map((entry) => entry.id)).toEqual(['un-prompt.md']);

    await prompts.delete('un-prompt.md');
    expect(await prompts.list()).toEqual([]);
    expect(await notes.list()).toHaveLength(1);
  });

  it('lets the same name exist in both libraries', async () => {
    // No shared namespace: the id is only unique within one folder, so the same title saved in
    // both places must not collide or suffix.
    const notes = storeAt(join(workDir, 'notes'));
    const prompts = storeAt(join(workDir, 'prompts'));

    expect((await notes.save('# Revue de PR\nx')).id).toBe('revue-de-pr.md');
    expect((await prompts.save('# Revue de PR\ny')).id).toBe('revue-de-pr.md');
  });

  it('never prunes, however many documents there are', async () => {
    // The property that separates a note from a snapshot. History caps at 200 and drops the
    // oldest; a note the user deliberately saved must still be there.
    const store = storeAt();
    for (let index = 0; index < 300; index += 1) {
      await store.save(`# Note ${index}\ncorps`);
    }

    expect(await store.list()).toHaveLength(300);
  });
});
