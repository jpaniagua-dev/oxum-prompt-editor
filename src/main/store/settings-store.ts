import { readFile } from 'node:fs/promises';
import type { AppSettings, RewritePreset, ThemeMode, WindowBounds } from '@shared/contracts.js';
import { atomicWriteFile, fileExists } from './atomic-write.js';

/** Defaults chosen so a fresh install is immediately usable with no configuration. */
export const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'Control+Alt+Space',
  // Following the OS is the least surprising default: the popup matches whatever the rest of
  // the desktop is doing without the user configuring anything.
  themeMode: 'system',
  alwaysOnTop: true,
  // Off on purpose: a popup that vanishes while you pause to think is worse than one
  // that lingers, and this app's whole promise is that text never disappears.
  hideOnBlur: false,
  openAtLogin: false,
  fontSize: 15,
  model: 'sonnet',
  claudePath: '',
  defaultPresetId: 'structure',
  maxBudgetUsd: 0.5,
  customPresets: [],
};

export const DEFAULT_BOUNDS: WindowBounds = { x: -1, y: -1, width: 820, height: 620 };

/**
 * Reads and writes `settings.json`.
 *
 * Unknown keys in the file are dropped and missing keys fall back to defaults, so a
 * hand-edited or outdated file degrades instead of breaking startup.
 */
export class SettingsStore {
  private cache: AppSettings = { ...DEFAULT_SETTINGS };

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppSettings> {
    if (!fileExists(this.filePath)) {
      return this.cache;
    }
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.cache = sanitizeSettings(raw);
    } catch (error) {
      console.error('[settings-store] unreadable settings, using defaults', error);
    }
    return this.cache;
  }

  get(): AppSettings {
    return this.cache;
  }

  /** Merges a patch into the settings and persists the result. */
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.cache = sanitizeSettings({ ...this.cache, ...patch });
    await atomicWriteFile(this.filePath, `${JSON.stringify(this.cache, null, 2)}\n`);
    return this.cache;
  }
}

/**
 * Coerces arbitrary JSON into valid settings.
 *
 * Exported for testing: this is the boundary that protects the app from a corrupted or
 * hand-edited configuration file.
 */
export function sanitizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_SETTINGS };
  }
  const input = raw as Record<string, unknown>;

  return {
    globalShortcut: asString(input.globalShortcut, DEFAULT_SETTINGS.globalShortcut),
    themeMode: asThemeMode(input.themeMode),
    alwaysOnTop: asBoolean(input.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    hideOnBlur: asBoolean(input.hideOnBlur, DEFAULT_SETTINGS.hideOnBlur),
    openAtLogin: asBoolean(input.openAtLogin, DEFAULT_SETTINGS.openAtLogin),
    fontSize: clamp(asNumber(input.fontSize, DEFAULT_SETTINGS.fontSize), 10, 32),
    model: asString(input.model, DEFAULT_SETTINGS.model),
    claudePath: asString(input.claudePath, DEFAULT_SETTINGS.claudePath),
    defaultPresetId: asString(input.defaultPresetId, DEFAULT_SETTINGS.defaultPresetId),
    maxBudgetUsd: clamp(asNumber(input.maxBudgetUsd, DEFAULT_SETTINGS.maxBudgetUsd), 0.01, 20),
    customPresets: asPresets(input.customPresets),
  };
}

function asThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_SETTINGS.themeMode;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalises user presets into complete `RewritePreset` objects.
 *
 * A hand-written entry may omit `hint` or `kind`, and may carry keys we know nothing about.
 * Rebuilding the object rather than filtering it keeps those unknown keys out of the file on
 * the next write, and guarantees the rest of the app never meets a half-built preset.
 * `kind` defaults to `agent-prompt`: that is what every preset was before the family split.
 */
function asPresets(value: unknown): RewritePreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const presets: RewritePreset[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const { id, label, systemPrompt } = candidate;
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      typeof label !== 'string' ||
      typeof systemPrompt !== 'string' ||
      systemPrompt.length === 0
    ) {
      continue;
    }
    presets.push({
      id,
      label,
      hint: asString(candidate.hint, ''),
      kind: candidate.kind === 'text' ? 'text' : 'agent-prompt',
      systemPrompt,
    });
  }
  return presets;
}
