import { describe, expect, it } from 'vitest';
import {
  rewrapResult,
  scopeOfSelection,
  scopeStillHolds,
} from '../src/renderer/editor/rewrite-scope.js';

describe('scopeOfSelection', () => {
  it('sends the selection without its surrounding whitespace', () => {
    const document = 'Titre\n\n  une frase a corigé\n\nSuite';
    const from = document.indexOf('  une');
    const to = document.indexOf('Suite');

    const scope = scopeOfSelection(document, from, to);

    expect(scope?.core).toBe('une frase a corigé');
    expect(scope?.lead).toBe('  ');
    expect(scope?.trail).toBe('\n\n');
    expect(scope?.original).toBe('  une frase a corigé\n\n');
  });

  it('has nothing to rewrite in a selection of blanks', () => {
    expect(scopeOfSelection('a   \n  b', 1, 6)).toBeNull();
  });
});

describe('rewrapResult', () => {
  it('puts the answer back inside the original whitespace', () => {
    // A model returns a trimmed answer. Without this, a selection ending on a line break would
    // come back without it and glue the next line onto the rewritten one.
    const document = 'avant\n  une frase\nSuite';
    const scope = scopeOfSelection(document, 6, 18);
    if (scope === null) {
      throw new Error('expected a scope');
    }

    expect(rewrapResult(scope, '\nune phrase\n\n')).toBe('  une phrase\n');
  });
});

describe('scopeStillHolds', () => {
  it('accepts an untouched range and refuses one edited in the meantime', () => {
    const document = 'Bonjour le monde';
    const scope = scopeOfSelection(document, 8, 16);
    if (scope === null) {
      throw new Error('expected a scope');
    }

    expect(scopeStillHolds(document, scope)).toBe(true);
    // Typing before the range shifts it: the offsets now point at different words.
    expect(scopeStillHolds(`Oh. ${document}`, scope)).toBe(false);
  });
});
