import { requireElement } from './dom.js';

const VISIBLE_MS = 1800;

/** Transient confirmation for actions whose effect is otherwise invisible, such as a copy. */
export class Toast {
  private readonly element = requireElement<HTMLDivElement>('toast');
  private timer: number | null = null;

  show(message: string): void {
    this.element.textContent = message;
    this.element.hidden = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      this.element.hidden = true;
      this.timer = null;
    }, VISIBLE_MS);
  }
}
