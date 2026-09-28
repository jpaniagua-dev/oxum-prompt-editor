/**
 * What a rewrite works on: the whole draft, or the part of it that was selected.
 *
 * Kept free of any CodeMirror import so it can be tested in plain Node, like the shortcut tables.
 */
export interface RewriteScope {
  /** Range in the document, `from` to `to`, as it stood when the rewrite started. */
  readonly from: number;
  readonly to: number;
  /** The whole selected text, used to check the range still holds it before applying. */
  readonly original: string;
  /** Whitespace around the selection, kept out of what the model sees and put back afterwards. */
  readonly lead: string;
  readonly trail: string;
  /** What the model actually receives. */
  readonly core: string;
}

/**
 * Builds the scope of a selection, or returns null when there is nothing worth rewriting in it.
 *
 * The surrounding whitespace is set aside because a model returns a trimmed answer: sent as is,
 * a selection that ends on a line break would come back without it and glue the next line onto
 * the rewritten one. Setting it aside and restoring it is exact, whatever the model does.
 */
export function scopeOfSelection(document: string, from: number, to: number): RewriteScope | null {
  const original = document.slice(from, to);
  const core = original.trim();
  if (core.length === 0) {
    return null;
  }
  const lead = original.slice(0, original.length - original.trimStart().length);
  const trail = original.slice(original.trimEnd().length);
  return { from, to, original, lead, trail, core };
}

/** The text that replaces the selection: the model's answer inside the original whitespace. */
export function rewrapResult(scope: RewriteScope, result: string): string {
  return `${scope.lead}${result.trim()}${scope.trail}`;
}

/**
 * Whether the document still holds, at the recorded range, the text that was sent.
 *
 * The draft stays editable while the model works. If the user typed inside or before the range
 * in the meantime, the offsets no longer point at what was rewritten, and replacing them would
 * overwrite words the model never saw. Refusing is the only safe answer; the result can still be
 * copied.
 */
export function scopeStillHolds(document: string, scope: RewriteScope): boolean {
  return document.slice(scope.from, scope.to) === scope.original;
}
