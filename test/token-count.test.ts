import { describe, expect, it } from 'vitest';
import { estimateTokens, formatCount } from '../src/renderer/ui/token-count.js';

describe('estimateTokens', () => {
  it('reports nothing for an empty draft', () => {
    // The badge hides on zero; returning 0 rather than 1 is what lets it.
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up, so a fragment never estimates to zero tokens', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
  });

  it('counts code points, not bytes', () => {
    // A naive byte count would inflate French prose by roughly the number of accents.
    expect(estimateTokens('éééé')).toBe(estimateTokens('eeee'));
  });

  it('scales linearly with length', () => {
    expect(estimateTokens('x'.repeat(370))).toBe(100);
  });
});

describe('formatCount', () => {
  it('leaves small numbers alone', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('groups thousands with a plain space, never a no-break variant', () => {
    // `toLocaleString('fr-FR')` emits U+202F or U+00A0 depending on the ICU build. Both render
    // inconsistently in the UI font, so the normalisation is the behaviour under test.
    const formatted = formatCount(1284);

    expect(formatted).toBe('1 284');
    expect(formatted).not.toMatch(/[  ]/);
  });

  it('groups every triple of a large number', () => {
    expect(formatCount(1234567)).toBe('1 234 567');
  });
});
