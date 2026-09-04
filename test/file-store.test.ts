import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../src/main/store/file-store.js';

let directory = '';

/** A store whose dialog is scripted, so the tests never open a native window. */
function storeThatPicks(toOpen: string | null): FileStore {
  return new FileStore({ chooseToOpen: async () => toOpen });
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

    const opened = await storeThatPicks(path).open();

    expect(opened).toEqual({ path, name: 'notes.md', text: '# Titre\n' });
  });

  it('returns null when the open dialog is cancelled', async () => {
    expect(await storeThatPicks(null).open()).toBeNull();
  });

  it('refuses a file too large for the editor to hold', async () => {
    const path = join(directory, 'enorme.md');
    await writeFile(path, 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8');

    await expect(storeThatPicks(path).open()).rejects.toThrow(/trop volumineux/i);
  });

  /**
   * The reason there is nothing else to test here: this store reads and never writes.
   *
   * Writing back would mean holding an absolute path the user picked in a dialog and later
   * accepting it from the renderer, with no pattern able to tell a legitimate target from
   * `C:\Windows\System32\drivers\etc\hosts`. The app produces text to copy out, kept in the
   * draft and in the two libraries, so an opened file is an input to that flow. A regression
   * here would show up as a write method appearing on the class.
   */
  it('exposes no way to write', () => {
    const store: Record<string, unknown> = storeThatPicks(null) as unknown as Record<
      string,
      unknown
    >;
    for (const name of ['save', 'saveAs', 'write', 'overwrite']) {
      expect(store[name], name).toBeUndefined();
    }
  });

  it('keeps a CRLF file exactly as it is on disk', async () => {
    const path = join(directory, 'windows.md');
    await writeFile(path, '# Titre\r\n\r\nUne ligne.\r\n', 'utf8');

    const opened = await storeThatPicks(path).open();

    // Handed over verbatim: CodeMirror normalises the breaks itself when the document loads,
    // and since nothing is ever written back there is no line ending to restore afterwards.
    expect(opened?.text).toBe('# Titre\r\n\r\nUne ligne.\r\n');
  });
});
