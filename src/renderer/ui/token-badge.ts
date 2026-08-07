import { requireElement } from './dom.js';
import { estimateTokens, formatCount } from './token-count.js';

/**
 * The token estimate, pinned to the bottom-right of the editor.
 *
 * The status bar already carried this number, but at 11px in the faintest text colour it was
 * unreadable at a glance — and a prompt's token budget is exactly the kind of thing you check
 * while typing, not by hunting for it. The badge lives over the text so the eye finds it
 * without leaving the writing area.
 *
 * No `aria-live`: the value changes on every keystroke, and announcing that would make the
 * editor unusable with a screen reader. The badge is a glanceable heuristic, not a measurement
 * anything depends on.
 */
export class TokenBadge {
  private readonly root = requireElement<HTMLDivElement>('token-badge');

  update(text: string): void {
    // An empty draft has nothing worth reporting: "~0 tok" would be pure furniture.
    if (text.length === 0) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.root.textContent = `~${formatCount(estimateTokens(text))} tok`;
  }
}
