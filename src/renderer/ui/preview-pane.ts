import { renderMarkdown } from '../preview/render-markdown.js';
import { clearChildren, createElement, requireElement } from './dom.js';

export interface PreviewPaneOptions {
  /** Called when a link in the rendered document is activated. */
  readonly onLinkActivate: (url: string) => void;
}

/**
 * The rendered view of the draft, shown in place of the editor.
 *
 * A full swap rather than a second column: the popup is often under 700px wide, and splitting it
 * would leave two unreadable ones. Reading and writing are separate moments here anyway — you
 * write the prompt, then you check how it will land.
 *
 * It is deliberately a *snapshot*: the document is rendered once, on entry, and never follows
 * the editor. Nothing can change the text while the editor is hidden, so there is nothing to
 * follow, and a re-render on every keystroke would only be latency with no observable effect.
 */
export class PreviewPane {
  private readonly root = requireElement<HTMLDivElement>('preview');
  private visible = false;

  constructor(private readonly options: PreviewPaneOptions) {}

  get isOpen(): boolean {
    return this.visible;
  }

  /** Renders `text` and reveals the pane, scrolled back to the top. */
  show(text: string): void {
    this.render(text);
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.visible = true;
  }

  /** Hides the pane and drops the rendered document, which can be large. */
  hide(): void {
    this.root.hidden = true;
    clearChildren(this.root);
    this.visible = false;
  }

  private render(text: string): void {
    clearChildren(this.root);

    if (text.trim().length === 0) {
      this.root.append(
        createElement('p', {
          className: 'preview__empty',
          text: 'Rien à afficher : le brouillon est vide.',
        }),
      );
      return;
    }

    this.root.append(
      renderMarkdown(text, { onLinkActivate: (url) => this.options.onLinkActivate(url) }),
    );
  }
}
