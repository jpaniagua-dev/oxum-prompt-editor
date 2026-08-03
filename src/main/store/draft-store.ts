import { readFile } from 'node:fs/promises';
import { atomicWriteFile, fileExists } from './atomic-write.js';

/** How long to wait after the last keystroke before touching the disk. */
const AUTOSAVE_DEBOUNCE_MS = 300;

/**
 * Owns the live draft: the text the user is currently typing.
 *
 * Design contract: after any keystroke, the draft is on disk within
 * `AUTOSAVE_DEBOUNCE_MS`, and `flush()` guarantees it immediately. The in-memory copy
 * is always the newest, so a flush triggered by blur, hide or quit can never write
 * stale content.
 */
export class DraftStore {
  private current = '';
  private pendingTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private lastWritten: string | null = null;

  constructor(
    private readonly filePath: string,
    private readonly debounceMs: number = AUTOSAVE_DEBOUNCE_MS,
  ) {}

  /** Reads the draft persisted by a previous session. Empty string when there is none. */
  async load(): Promise<{ text: string; recovered: boolean }> {
    if (!fileExists(this.filePath)) {
      return { text: '', recovered: false };
    }
    try {
      const text = await readFile(this.filePath, 'utf8');
      this.current = text;
      this.lastWritten = text;
      return { text, recovered: text.length > 0 };
    } catch (error) {
      // A draft we cannot read must not prevent the app from starting: the user needs
      // a working editor more than they need this recovery.
      console.error('[draft-store] failed to read draft, starting empty', error);
      return { text: '', recovered: false };
    }
  }

  /** Records a new buffer value and schedules a debounced write. */
  update(text: string): void {
    this.current = text;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /**
   * Writes the current buffer now and resolves once it is durably on disk.
   *
   * Writes are serialised through a promise chain so two overlapping flushes cannot
   * interleave their rename calls.
   */
  flush(): Promise<void> {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    const snapshot = this.current;
    if (snapshot === this.lastWritten) {
      return this.writeChain;
    }

    this.writeChain = this.writeChain.then(async () => {
      try {
        await atomicWriteFile(this.filePath, snapshot);
        this.lastWritten = snapshot;
      } catch (error) {
        // Surface the failure but keep `lastWritten` untouched so the next flush retries.
        console.error('[draft-store] autosave failed', error);
      }
    });

    return this.writeChain;
  }

  /** The newest known buffer value, even if not yet written. */
  peek(): string {
    return this.current;
  }
}
