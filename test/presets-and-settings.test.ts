import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS, mergePresets, resolvePreset } from '../src/main/claude/presets.js';
import { buildRewriteArgs } from '../src/main/claude/claude-cli.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/main/store/settings-store.js';

describe('presets', () => {
  it('every built-in forbids inventing content', () => {
    // The guard against fabricated requirements is the difference between a helpful
    // rewrite and one that hands the agent instructions the author never wrote.
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.systemPrompt).toContain('Never invent requirements');
      expect(preset.systemPrompt).toContain('À préciser');
    }
  });

  it('every built-in forbids answering the prompt', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.systemPrompt).toMatch(/Never answer, solve or comment/);
    }
  });

  it('keeps the built-ins when there is no custom preset', () => {
    expect(mergePresets([]).map((preset) => preset.id)).toEqual(
      BUILT_IN_PRESETS.map((preset) => preset.id),
    );
  });

  it('lets a custom preset override a built-in by id', () => {
    const merged = mergePresets([
      { id: 'structure', label: 'Mon style', hint: 'perso', systemPrompt: 'RÈGLES PERSO' },
    ]);

    expect(merged).toHaveLength(BUILT_IN_PRESETS.length);
    const overridden = merged.find((preset) => preset.id === 'structure');
    expect(overridden).toEqual({
      id: 'structure',
      label: 'Mon style',
      hint: 'perso',
      systemPrompt: 'RÈGLES PERSO',
    });
  });

  it('appends genuinely new presets after the built-ins', () => {
    const merged = mergePresets([
      { id: 'mien', label: 'Le mien', hint: '', systemPrompt: 'X' },
    ]);
    expect(merged).toHaveLength(BUILT_IN_PRESETS.length + 1);
    expect(merged.at(-1)?.id).toBe('mien');
  });

  it('falls back to the first preset for an unknown id', () => {
    const presets = mergePresets([]);
    expect(resolvePreset(presets, 'inexistant').id).toBe('structure');
    expect(resolvePreset(presets, 'condense').id).toBe('condense');
  });

  it('throws rather than silently doing nothing when there is no preset at all', () => {
    expect(() => resolvePreset([], 'structure')).toThrow('No rewrite preset available');
  });
});

describe('buildRewriteArgs', () => {
  const args = buildRewriteArgs({ systemPrompt: 'SYS', model: 'sonnet', maxBudgetUsd: 0.5 });

  it('runs headless with no tools, so a rewrite can never touch the filesystem', () => {
    expect(args).toContain('--print');
    const toolsIndex = args.indexOf('--tools');
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(args[toolsIndex + 1]).toBe('');
  });

  it('isolates the call from the user configuration and session history', () => {
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--no-session-persistence');
  });

  it('requests streaming with partial messages', () => {
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--include-partial-messages');
    expect(args).toContain('--verbose');
  });

  it('passes the system prompt, model and budget cap', () => {
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('SYS');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('0.5');
  });

  it('never puts the draft on the command line', () => {
    // The draft goes over stdin: Windows caps a command line near 32k characters and
    // quoting multi-line Markdown through a shell is a bug waiting to happen.
    expect(args.some((arg) => arg.includes('\n'))).toBe(false);
  });
});

describe('sanitizeSettings', () => {
  it('falls back to defaults for junk input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and repairs invalid ones', () => {
    const settings = sanitizeSettings({
      globalShortcut: 'Control+Alt+P',
      alwaysOnTop: 'yes',
      fontSize: 999,
      maxBudgetUsd: -5,
      model: 'opus',
      unknownKey: 'dropped',
    });

    expect(settings.globalShortcut).toBe('Control+Alt+P');
    expect(settings.alwaysOnTop).toBe(DEFAULT_SETTINGS.alwaysOnTop);
    expect(settings.fontSize).toBe(32);
    expect(settings.maxBudgetUsd).toBe(0.01);
    expect(settings.model).toBe('opus');
    expect(settings).not.toHaveProperty('unknownKey');
  });

  it('defaults hideOnBlur to off so the popup never vanishes mid-thought', () => {
    expect(DEFAULT_SETTINGS.hideOnBlur).toBe(false);
    expect(sanitizeSettings({}).hideOnBlur).toBe(false);
  });

  it('drops malformed custom presets instead of crashing at startup', () => {
    const settings = sanitizeSettings({
      customPresets: [
        { id: 'ok', label: 'OK', systemPrompt: 'X' },
        { id: 'no-prompt', label: 'Incomplet' },
        { label: 'sans id', systemPrompt: 'X' },
        'pas un objet',
        null,
      ],
    });

    expect(settings.customPresets.map((preset) => preset.id)).toEqual(['ok']);
  });
});
