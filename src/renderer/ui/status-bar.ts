import { requireElement } from './dom.js';
import { formatCount } from './token-count.js';

/**
 * The bottom bar: size of the draft, save state, and the last transient message.
 *
 * The token estimate deliberately lives elsewhere, in the editor badge: showing the same
 * number twice, twenty pixels apart, is noise rather than reassurance.
 */
export class StatusBar {
  private readonly counts = requireElement<HTMLSpanElement>('status-counts');
  private readonly save = requireElement<HTMLSpanElement>('status-save');
  private readonly message = requireElement<HTMLSpanElement>('status-message');
  private savedAt: number | null = null;
  private ticker: number | null = null;

  updateCounts(text: string): void {
    const chars = text.length;
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    this.counts.textContent = `${formatCount(chars)} car. · ${formatCount(lines)} l.`;
  }

  /** Marks the draft as persisted and starts the "saved Xs ago" ticker. */
  markSaved(now: number = Date.now()): void {
    this.savedAt = now;
    this.renderSaved();
    if (this.ticker === null) {
      this.ticker = window.setInterval(() => this.renderSaved(), 5000);
    }
  }

  markPending(): void {
    this.save.textContent = 'modifié…';
  }

  setMessage(message: string, isError = false): void {
    this.message.textContent = message;
    this.message.classList.toggle('statusbar__message--error', isError);
  }

  private renderSaved(): void {
    if (this.savedAt === null) {
      return;
    }
    const seconds = Math.round((Date.now() - this.savedAt) / 1000);
    this.save.textContent = seconds < 5 ? 'sauvegardé' : `sauvegardé il y a ${seconds}s`;
  }
}
