import { clearChildren, createElement, requireElement } from './dom.js';

export interface PanelButton {
  readonly label: string;
  readonly title?: string;
  readonly variant?: 'primary' | 'accent' | 'plain';
  readonly onClick: () => void;
}

/**
 * The single side panel, shared by the rewrite result and the history list.
 *
 * One panel rather than two keeps the popup from ever showing competing columns in a window
 * that may only be 820px wide.
 */
export class SidePanel {
  private readonly root = requireElement<HTMLElement>('side-panel');
  private readonly title = requireElement<HTMLSpanElement>('side-panel-title');
  private readonly body = requireElement<HTMLDivElement>('side-panel-body');
  private readonly footer = requireElement<HTMLDivElement>('side-panel-footer');
  private readonly closeButton = requireElement<HTMLButtonElement>('panel-close');
  private mode: 'hidden' | 'rewrite' | 'history' = 'hidden';
  private onClose: (() => void) | null = null;

  constructor() {
    this.closeButton.addEventListener('click', () => this.close());
  }

  get currentMode(): 'hidden' | 'rewrite' | 'history' {
    return this.mode;
  }

  get isOpen(): boolean {
    return this.mode !== 'hidden';
  }

  /** Opens the panel in a given mode, resetting its content. */
  open(mode: 'rewrite' | 'history', title: string, onClose?: () => void): void {
    this.mode = mode;
    this.title.textContent = title;
    this.onClose = onClose ?? null;
    clearChildren(this.body);
    clearChildren(this.footer);
    this.body.classList.remove('side-panel__body--streaming');
    this.root.hidden = false;
  }

  close(): void {
    if (this.mode === 'hidden') {
      return;
    }
    const callback = this.onClose;
    this.mode = 'hidden';
    this.onClose = null;
    this.root.hidden = true;
    clearChildren(this.body);
    clearChildren(this.footer);
    callback?.();
  }

  /** Replaces the body with plain text, safe for arbitrary CLI output. */
  setText(text: string): void {
    this.body.textContent = text;
  }

  /** Appends streamed text and keeps the view pinned to the bottom. */
  appendText(text: string): void {
    this.body.append(document.createTextNode(text));
    this.body.scrollTop = this.body.scrollHeight;
  }

  setStreaming(streaming: boolean): void {
    this.body.classList.toggle('side-panel__body--streaming', streaming);
  }

  /** Shows an error in place of the content. */
  setError(message: string): void {
    clearChildren(this.body);
    this.body.append(createElement('div', { className: 'side-panel__error', text: message }));
  }

  /** Replaces the body with arbitrary nodes, used by the history list. */
  setContent(...nodes: readonly Node[]): void {
    clearChildren(this.body);
    this.body.append(...nodes);
  }

  /** Rebuilds the footer actions. */
  setActions(buttons: readonly PanelButton[]): void {
    clearChildren(this.footer);
    for (const spec of buttons) {
      const className =
        spec.variant === 'primary'
          ? 'button button--primary'
          : spec.variant === 'accent'
            ? 'button button--accent'
            : 'button';
      const button = createElement('button', { className, text: spec.label });
      if (spec.title !== undefined) {
        button.title = spec.title;
      }
      button.type = 'button';
      button.addEventListener('click', spec.onClick);
      this.footer.append(button);
    }
  }
}
