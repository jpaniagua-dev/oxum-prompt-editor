import { clearChildren, createElement, requireElement } from './dom.js';

export interface PanelButton {
  readonly label: string;
  readonly title?: string;
  readonly variant?: 'primary' | 'accent' | 'plain';
  readonly onClick: () => void;
}

/** What the panel is currently showing. */
export type PanelMode = 'hidden' | 'rewrite' | 'history' | 'notes' | 'prompts';

/** One tab of the strip, used when the panel shows something that has siblings. */
export interface PanelTab {
  /** The mode this tab displays, which is how the strip knows it is the selected one. */
  readonly id: PanelMode;
  readonly label: string;
  readonly onSelect: () => void;
}

export interface SidePanelOptions {
  /**
   * Called on every open and close.
   *
   * The toolbar opener has to mirror the panel, and the panel closes from half a dozen places
   * (Escape, its own close button, applying a rewrite, loading a note). Pushing the mode out
   * from here is the only way the button cannot fall out of step.
   */
  readonly onModeChange: (mode: PanelMode) => void;
}

/**
 * The single side panel, shared by the rewrite result, the history list and the two libraries.
 *
 * One panel rather than four keeps the popup from ever showing competing columns in a window
 * that may only be 820px wide. Settings do not use it: a form with one model field per action
 * needs more than 46% of the width, so it gets its own overlay.
 *
 * The three stores share the panel, so they are mutually exclusive, and that is now said in the
 * shape of the thing: one opener in the toolbar, a tab strip inside. Three separate toolbar
 * buttons for one panel could not express it, and none of them could show that it was active.
 */
export class SidePanel {
  private readonly root = requireElement<HTMLElement>('side-panel');
  private readonly title = requireElement<HTMLSpanElement>('side-panel-title');
  private readonly tabs = requireElement<HTMLDivElement>('side-panel-tabs');
  private readonly body = requireElement<HTMLDivElement>('side-panel-body');
  private readonly footer = requireElement<HTMLDivElement>('side-panel-footer');
  private readonly closeButton = requireElement<HTMLButtonElement>('panel-close');
  private mode: PanelMode = 'hidden';
  private onClose: (() => void) | null = null;
  /** Ticker of the pending placeholder, non-null only while one is displayed. */
  private pendingTicker: number | null = null;

  constructor(private readonly options: SidePanelOptions) {
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
    // Cleared like the body and the footer: a mode with siblings re-declares its strip right
    // after opening, and one without (a rewrite) must not inherit the previous mode's tabs.
    this.setTabs(null);
    this.root.hidden = false;
    this.options.onModeChange(mode);
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
    this.setTabs(null);
    this.options.onModeChange('hidden');
    callback?.();
  }

  /**
   * Draws the tab strip, or hides it when given null.
   *
   * The selected tab is derived from the panel's own mode rather than passed in, so the strip
   * cannot disagree with what is on screen: there is no second source of truth to keep in step.
   */
  setTabs(tabs: readonly PanelTab[] | null): void {
    clearChildren(this.tabs);
    if (tabs === null || tabs.length === 0) {
      this.tabs.hidden = true;
      return;
    }
    for (const tab of tabs) {
      const button = createElement('button', { className: 'side-panel__tab', text: tab.label });
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.id === this.mode));
      button.addEventListener('click', tab.onSelect);
      this.tabs.append(button);
    }
    this.tabs.hidden = false;
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
