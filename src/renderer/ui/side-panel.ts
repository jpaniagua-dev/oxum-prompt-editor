import { clearChildren, createElement, requireElement } from './dom.js';

export interface PanelButton {
  readonly label: string;
  readonly title?: string;
  readonly variant?: 'primary' | 'accent' | 'plain';
  readonly onClick: () => void;
}

/** What the panel is currently showing. */
export type PanelMode = 'hidden' | 'rewrite' | 'history' | 'notes' | 'prompts';

/**
 * The single side panel, shared by the rewrite result, the history list and the two libraries.
 *
 * One panel rather than four keeps the popup from ever showing competing columns in a window
 * that may only be 820px wide. Settings do not use it: a form with one model field per action
 * needs more than 46% of the width, so it gets its own overlay.
 */
export class SidePanel {
  private readonly root = requireElement<HTMLElement>('side-panel');
  private readonly title = requireElement<HTMLSpanElement>('side-panel-title');
  private readonly body = requireElement<HTMLDivElement>('side-panel-body');
  private readonly footer = requireElement<HTMLDivElement>('side-panel-footer');
  private readonly closeButton = requireElement<HTMLButtonElement>('panel-close');
  private mode: PanelMode = 'hidden';
  private onClose: (() => void) | null = null;
  /** Ticker of the pending placeholder, non-null only while one is displayed. */
  private pendingTicker: number | null = null;

  constructor() {
    this.closeButton.addEventListener('click', () => this.close());
  }

  get currentMode(): PanelMode {
    return this.mode;
  }

  get isOpen(): boolean {
    return this.mode !== 'hidden';
  }

  /** Opens the panel in a given mode, resetting its content. */
  open(mode: Exclude<PanelMode, 'hidden'>, title: string, onClose?: () => void): void {
    this.mode = mode;
    this.title.textContent = title;
    this.onClose = onClose ?? null;
    this.stopPending();
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
    this.stopPending();
    clearChildren(this.body);
    clearChildren(this.footer);
    callback?.();
  }

  /**
   * Shows that work has started but produced nothing yet.
   *
   * Streaming already has its own affordance, the blinking caret trailing the text. Before the
   * first chunk there is no text for it to trail, so the panel sat empty for the seconds the CLI
   * spends starting up and authenticating — indistinguishable from a hang. The elapsed counter
   * is the part that makes the difference: a spinner alone cannot say "slow" versus "stuck".
   */
  setPending(label: string): void {
    this.stopPending();
    clearChildren(this.body);

    const elapsed = createElement('span', { className: 'side-panel__elapsed', text: '0s' });
    const startedAt = Date.now();
    const pending = createElement('div', { className: 'side-panel__pending' });
    pending.append(
      createElement('span', { className: 'side-panel__spinner' }),
      createElement('span', { text: label }),
      elapsed,
    );
    this.body.append(pending);

    this.pendingTicker = window.setInterval(() => {
      elapsed.textContent = `${Math.round((Date.now() - startedAt) / 1000)}s`;
    }, 1000);
  }

  /** Replaces the body with plain text, safe for arbitrary CLI output. */
  setText(text: string): void {
    this.stopPending();
    this.body.textContent = text;
  }

  /** Appends streamed text and keeps the view pinned to the bottom. */
  appendText(text: string): void {
    // The first chunk is what retires the placeholder. The panel owns that so callers never
    // have to remember it, and so a stray ticker cannot outlive what it was counting for.
    if (this.pendingTicker !== null) {
      this.stopPending();
      clearChildren(this.body);
    }
    this.body.append(document.createTextNode(text));
    this.body.scrollTop = this.body.scrollHeight;
  }

  setStreaming(streaming: boolean): void {
    if (!streaming) {
      this.stopPending();
    }
    this.body.classList.toggle('side-panel__body--streaming', streaming);
  }

  /** Shows an error in place of the content. */
  setError(message: string): void {
    this.stopPending();
    clearChildren(this.body);
    this.body.append(createElement('div', { className: 'side-panel__error', text: message }));
  }

  /**
   * Stops the elapsed-time ticker.
   *
   * Every exit from the pending state routes through here. The window is hidden rather than
   * destroyed when the user presses Escape, so an interval left running would tick for the
   * whole session.
   */
  private stopPending(): void {
    if (this.pendingTicker !== null) {
      window.clearInterval(this.pendingTicker);
      this.pendingTicker = null;
    }
  }

  /** Replaces the body with arbitrary nodes, used by the history list. */
  setContent(...nodes: readonly Node[]): void {
    this.stopPending();
    clearChildren(this.body);
    this.body.append(...nodes);
  }

  /**
   * Puts ready-made nodes in the footer.
   *
   * `setActions` covers the plain "label plus handler" case. A stateful control, such as a button
   * that arms itself before confirming, owns its own DOM and cannot be described by a spec.
   */
  setFooterNodes(...nodes: readonly Node[]): void {
    clearChildren(this.footer);
    this.footer.append(...nodes);
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
