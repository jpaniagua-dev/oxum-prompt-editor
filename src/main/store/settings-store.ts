import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type {
  AppSettings,
  RewritePreset,
  RewriteProvider,
  ThemeMode,
  WindowBounds,
} from '@shared/contracts.js';
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
  rewriteProvider: 'claude',
  claude: {
    model: 'sonnet',
    modelByPresetId: {},
    cliPath: '',
    maxBudgetUsd: 0.5,
  },
  codex: {
    // Empty on purpose: Codex then uses the current CLI default rather than a stale app default.
    model: '',
    modelByPresetId: {},
    cliPath: '',
  },
  defaultPresetId: 'structure',
  // Empty means "the default directory under userData", resolved by the caller. Storing the
  // resolved path instead would freeze it, and it moves with the Electron user data directory
  // (a dev run uses its own).
  notesDirectory: '',
  promptsDirectory: '',
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
  private cache: AppSettings = freshDefaults();

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
    return freshDefaults();
  }
  const input = raw as Record<string, unknown>;
  const claude = asRecord(input.claude);
  const codex = asRecord(input.codex);

  return {
    globalShortcut: asString(input.globalShortcut, DEFAULT_SETTINGS.globalShortcut),
    themeMode: asThemeMode(input.themeMode),
    alwaysOnTop: asBoolean(input.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    hideOnBlur: asBoolean(input.hideOnBlur, DEFAULT_SETTINGS.hideOnBlur),
    openAtLogin: asBoolean(input.openAtLogin, DEFAULT_SETTINGS.openAtLogin),
    fontSize: clamp(asNumber(input.fontSize, DEFAULT_SETTINGS.fontSize), 10, 32),
    rewriteProvider: asRewriteProvider(input.rewriteProvider),
    claude: {
      // The top-level fallbacks migrate every settings file written before v0.10.0.
      model: asString(claude.model, asString(input.model, DEFAULT_SETTINGS.claude.model)),
      modelByPresetId: asModelMap(
        claude.modelByPresetId === undefined ? input.modelByPresetId : claude.modelByPresetId,
      ),
      cliPath: asString(
        claude.cliPath,
        asString(input.claudePath, DEFAULT_SETTINGS.claude.cliPath),
      ),
      maxBudgetUsd: clamp(
        asNumber(
          claude.maxBudgetUsd,
          asNumber(input.maxBudgetUsd, DEFAULT_SETTINGS.claude.maxBudgetUsd),
        ),
        0.01,
        20,
      ),
    },
    codex: {
      model: asString(codex.model, DEFAULT_SETTINGS.codex.model),
      modelByPresetId: asModelMap(codex.modelByPresetId),
      cliPath: asString(codex.cliPath, DEFAULT_SETTINGS.codex.cliPath),
    },
    defaultPresetId: asString(input.defaultPresetId, DEFAULT_SETTINGS.defaultPresetId),
    notesDirectory: asAbsolutePath(input.notesDirectory),
    promptsDirectory: asAbsolutePath(input.promptsDirectory),
    customPresets: asPresets(input.customPresets),
  };
}

/**
 * Model to use for one action: its own override when set, the global default otherwise.
 *
 * The fallback is what makes the feature safe to extend: a preset added later, by hand in
 * `settings.json`, has no entry here and must still inherit the selected provider's default.
 * Codex is the deliberate exception where that default may itself be empty, which omits the flag.
 */
export function resolveModelForPreset(
  settings: AppSettings,
  provider: RewriteProvider,
  presetId: string,
): string {
  const providerSettings = settings[provider];
  const override = providerSettings.modelByPresetId[presetId]?.trim() ?? '';
  return override.length > 0 ? override : providerSettings.model.trim();
}

/** Returns a fresh value so editing nested provider maps can never mutate the exported defaults. */
function freshDefaults(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    claude: { ...DEFAULT_SETTINGS.claude, modelByPresetId: {} },
    codex: { ...DEFAULT_SETTINGS.codex, modelByPresetId: {} },
    customPresets: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRewriteProvider(value: unknown): RewriteProvider {
  return value === 'codex' ? 'codex' : 'claude';
}

/**
 * Normalises the per-action model overrides.
 *
 * Unknown keys are kept on purpose: they may name a custom preset that is declared further down
 * the same file, or one the user is about to add. Empty values are dropped instead of stored,
 * so "no override" has a single representation rather than two.
 */
function asModelMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      result[key] = trimmed;
    }
  }
  return result;
}

/**
 * Accepts an absolute path, rejects anything else.
 *
 * A relative path here would be resolved against the working directory of a GUI process, which
 * is the Electron binary location when launched from the Start menu: notes would land somewhere
 * the user never chose. Falling back to the default is the same degrade-rather-than-break rule
 * the rest of this function follows.
 */
function asAbsolutePath(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && isAbsolute(trimmed) ? trimmed : '';
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
