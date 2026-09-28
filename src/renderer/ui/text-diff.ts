import { diffWordsWithSpace } from 'diff';

/** One run of the diff: text both versions share, or text only one of them has. */
export interface DiffSegment {
  readonly kind: 'same' | 'added' | 'removed';
  readonly text: string;
}

export interface TextDiff {
  readonly segments: readonly DiffSegment[];
  /**
   * Number of places the text changed.
   *
   * A replacement is one removal immediately followed by one addition, and counting it twice
   * would report "2 changes" for a single corrected word.
   */
  readonly changes: number;
}

/**
 * Word-level diff between the text sent to the model and the text it returned.
 *
 * Words rather than characters: a corrected agreement ("les chat" → "les chats") reads as one
 * word swapped, whereas a character diff scatters single letters the eye has to reassemble.
 * Whitespace is kept as its own token, because French typography is precisely a whitespace change
 * (a non-breaking space before ":"), and a diff that ignored it would show nothing for it.
 *
 * Both sides are normalised to `\n` first: the editor already holds `\n` only, and a CLI answering
 * in `\r\n` would otherwise mark every line as changed.
 */
export function diffTexts(original: string, result: string): TextDiff {
  const parts = diffWordsWithSpace(normalise(original), normalise(result));
  const segments: DiffSegment[] = [];
  let changes = 0;
  let previous: DiffSegment['kind'] = 'same';

  for (const part of parts) {
    const kind: DiffSegment['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'same';
    if (kind !== 'same' && !(kind === 'added' && previous === 'removed')) {
      changes += 1;
    }
    segments.push({ kind, text: part.value });
    previous = kind;
  }

  return { segments, changes };
}

function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
