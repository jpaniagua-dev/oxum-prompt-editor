/**
 * Draft measurements.
 *
 * Pure functions, no DOM: both the status bar and the editor badge read from here, and the
 * arithmetic can be tested without standing up a document.
 */

/**
 * ~3.7 characters per token is a reasonable average for mixed French/English prose with code.
 * It is presented as an estimate in the UI: the real count depends on the tokeniser, and
 * pretending otherwise would be a lie dressed as precision.
 */
const CHARS_PER_TOKEN = 3.7;

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Formats a count with plain spaces, French style.
 *
 * `toLocaleString('fr-FR')` groups with a narrow no-break space (U+202F) or a no-break space
 * (U+00A0) depending on the ICU build. Both render inconsistently in the UI font, so they are
 * normalised to a regular space. Beware when editing: the character class holds those two
 * literal code points, invisible in source and indistinguishable from the plain space they
 * map to. An editor that "cleans up whitespace" here silently breaks the grouping.
 */
export function formatCount(value: number): string {
  return value.toLocaleString('fr-FR').replace(/[  ]/g, ' ');
}
