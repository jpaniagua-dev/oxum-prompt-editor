import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../src/main/claude/presets.js';
import { assignAccessKeys } from '../src/renderer/ui/access-keys.js';

describe('assignAccessKeys', () => {
  it('gives every built-in its declared letter, all distinct', () => {
    // The letters are what a user learns, so the built-ins declare theirs instead of deriving
    // them: three "Traduire" labels would otherwise fight over the same first letter.
    const keys = assignAccessKeys(BUILT_IN_PRESETS);
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.accessKey, preset.id).toMatch(/^[a-z]$/);
      expect(keys.get(preset.id), preset.id).toBe(preset.accessKey);
    }
    expect(new Set(keys.values()).size).toBe(BUILT_IN_PRESETS.length);
  });

  it('lets a declared letter win over a derived one, whatever the order', () => {
    // A custom preset listed first must not take the letter a built-in declares, or that letter
    // would move the day the user adds a preset.
    const keys = assignAccessKeys([
      { id: 'custom', label: 'Clarifier' },
      { id: 'fix', label: 'Corriger', accessKey: 'c' },
    ]);
    expect(keys.get('fix')).toBe('c');
    expect(keys.get('custom')).toBe('l');
  });

  it('falls back to the label when a declared letter is taken or invalid', () => {
    const keys = assignAccessKeys([
      { id: 'a', label: 'Alpha', accessKey: 'x' },
      { id: 'b', label: 'Bravo', accessKey: 'x' },
      { id: 'c', label: 'Charlie', accessKey: '??' },
    ]);
    expect(keys.get('a')).toBe('x');
    expect(keys.get('b')).toBe('b');
    expect(keys.get('c')).toBe('c');
  });

  it('strips accents and skips anything that is not a letter or a digit', () => {
    const keys = assignAccessKeys([{ id: 'e', label: '« Épurer »' }]);
    expect(keys.get('e')).toBe('e');
  });

  it('leaves a preset without a letter rather than inventing one', () => {
    const keys = assignAccessKeys([
      { id: 'first', label: 'ab' },
      { id: 'second', label: 'ba' },
      { id: 'third', label: 'ab' },
    ]);
    expect(keys.get('first')).toBe('a');
    expect(keys.get('second')).toBe('b');
    expect(keys.has('third')).toBe(false);
  });
});
