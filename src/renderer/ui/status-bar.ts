import { requireElement } from './dom.js';

/**
 * Rough token estimate.
 *
 * ~3.7 characters per token is a reasonable average for mixed French/English prose with
 * code. It is presented as an estimate in the UI: the real count depends on the tokeniser,
 * and pretending otherwise would be a lie dressed as precision.
 */
const CHARS_PER_TOKEN = 3.7;

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Formats a character count with thin spaces, French style. */
function formatCount(value: number): string {
  return value.toLocaleString('fr-FR').replace(/ | /g, ' ');
}

/** The bottom bar: size of the draft, save state, and the last transient message. */
export class StatusBar {
  private readonly counts = requireElement<HTMLSpanElement>('status-counts');
  private readonly save = requireElement<HTMLSpanElement>('status-save');
  private readonly message = requireElement<HTMLSpanElement>('status-message');
  private savedAt: number | null = null;
  private ticker: number | null = null;

  updateCounts(text: string): void {
    const chars = text.length;
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    this.counts.textContent = `${formatCount(chars)} car. · ${formatCount(lines)} l. · ~${formatCount(estimateTokens(text))} tok.`;
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
