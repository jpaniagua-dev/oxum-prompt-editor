import { requireElement } from './dom.js';

const VISIBLE_MS = 1800;

/**
 * Confirmation for actions whose effect is otherwise invisible, such as a copy, and the app's
 * only error channel.
 *
 * Failures used to go to the status bar, where they were 11px, faint, truncated by an ellipsis
 * and never cleared, while a successful copy got this centred pill. The channels were the wrong
 * way round. Errors behave differently from confirmations on purpose: no timeout, because a
 * failure the user blinked past is a failure they will not act on, and a click to dismiss, so
 * acknowledging one is deliberate. The base rule sets `pointer-events: none`, so only the error
 * variant is actually clickable.
 */
export class Toast {
  private readonly element = requireElement<HTMLDivElement>('toast');
  private timer: number | null = null;

  constructor() {
    this.element.addEventListener('click', () => this.hide());
  }

  /** A short-lived confirmation. */
  show(message: string): void {
    this.render(message, false);
    this.timer = window.setTimeout(() => this.hide(), VISIBLE_MS);
  }

  /** A failure, which stays on screen until it is dismissed. */
  error(message: string): void {
    this.render(message, true);
  }

  private render(message: string, isError: boolean): void {
    this.clearTimer();
    this.element.textContent = message;
    this.element.classList.toggle('toast--error', isError);
    this.element.hidden = false;
  }

  private hide(): void {
    this.clearTimer();
    this.element.hidden = true;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
