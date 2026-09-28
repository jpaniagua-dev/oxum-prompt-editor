import { describe, expect, it } from 'vitest';
import { diffTexts } from '../src/renderer/ui/text-diff.js';

/** Renders a diff compactly: `[-removed-]` and `{+added+}`. */
function render(original: string, result: string): string {
  return diffTexts(original, result)
    .segments.map((segment) =>
      segment.kind === 'removed'
        ? `[-${segment.text}-]`
        : segment.kind === 'added'
          ? `{+${segment.text}+}`
          : segment.text,
    )
    .join('');
}

describe('diffTexts', () => {
  it('reports no change on an identical text', () => {
    const diff = diffTexts('Rien à corriger.', 'Rien à corriger.');
    expect(diff.changes).toBe(0);
    expect(diff.segments).toEqual([{ kind: 'same', text: 'Rien à corriger.' }]);
  });

  it('works on words and counts a replacement once', () => {
    const diff = diffTexts('les chat dorment', 'les chats dorment');
    expect(render('les chat dorment', 'les chats dorment')).toBe('les [-chat-]{+chats+} dorment');
    expect(diff.changes).toBe(1);
  });

  it('shows a whitespace-only change, which is what French typography is', () => {
    const nbsp = String.fromCharCode(0xa0);
    const diff = diffTexts('Attention : ici', `Attention${nbsp}: ici`);
    expect(diff.changes).toBe(1);
    expect(diff.segments.some((segment) => segment.kind === 'added' && segment.text === nbsp)).toBe(
      true,
    );
  });

  it('ignores line endings, so a CRLF answer is not a rewrite of every line', () => {
    expect(diffTexts('un\ndeux\n', 'un\r\ndeux\r\n').changes).toBe(0);
  });
});
