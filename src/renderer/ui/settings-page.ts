import type { AppSettings, LibraryId, RewritePreset } from '@shared/contracts.js';
import { clearChildren, createElement, requireElement } from './dom.js';

export interface SettingsPageCallbacks {
  /** Commit: the complete settings as edited. Nothing is applied before this fires. */
  readonly onSave: (settings: AppSettings) => void;
  readonly onPickDirectory: (current: string) => Promise<string | null>;
  /** Fired whether the page was saved or cancelled, so the caller can restore its chrome. */
  readonly onClose: () => void;
}

/**
 * The settings overlay.
 *
 * Edits go into a working copy and reach the app only on `Enregistrer`. An earlier version wrote
 * each field as it changed, which meant no way back from a mistyped global shortcut and a theme
 * that flipped while you were still reading the options. Explicit commit also gives `Annuler` and
 * `Échap` a single, obvious meaning: nothing was applied, so nothing has to be undone.
 *
 * Built imperatively with `createElement`, never with `innerHTML`: the values rendered here
 * include paths and model names the user typed, and the page runs under a CSP that exists
 * precisely so arbitrary text can never become markup.
 */
export class SettingsPage {
  private readonly root = requireElement<HTMLElement>('settings-page');
  private readonly body = requireElement<HTMLDivElement>('settings-page-body');
  private readonly closeButton = requireElement<HTMLButtonElement>('settings-close');
  private readonly cancelButton = requireElement<HTMLButtonElement>('settings-cancel');
  private readonly saveButton = requireElement<HTMLButtonElement>('settings-save');
  private readonly dirtyLabel = requireElement<HTMLSpanElement>('settings-dirty');

  private open = false;
  /** The settings as they were on opening, for the dirty check. */
  private original = '';
  /** The working copy every field writes into. */
  private draft: AppSettings | null = null;

  constructor(private readonly callbacks: SettingsPageCallbacks) {
    this.closeButton.addEventListener('click', () => this.close());
    this.cancelButton.addEventListener('click', () => this.close());
    this.saveButton.addEventListener('click', () => this.save());
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Renders the form from the current settings and shows it. */
  show(
    settings: AppSettings,
    presets: readonly RewritePreset[],
    defaultDirectories: Readonly<Record<LibraryId, string>>,
  ): void {
    // A structured clone rather than a spread: `modelByPresetId` is nested, and a shallow copy
    // would let a field edit reach the caller's object before anything was saved.
    this.draft = structuredClone(settings);
    this.original = JSON.stringify(settings);

    clearChildren(this.body);
    this.body.append(
      this.windowSection(),
      this.editorSection(),
      this.claudeSection(presets),
      this.storageSection(defaultDirectories),
    );
    this.markDirty();
    this.open = true;
    this.root.hidden = false;
    this.body.scrollTop = 0;
  }

  /** Closes without applying anything. */
  close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.draft = null;
    this.root.hidden = true;
    clearChildren(this.body);
    this.callbacks.onClose();
  }

  private save(): void {
    if (this.draft === null) {
      return;
    }
    this.callbacks.onSave(this.draft);
    this.close();
  }

  /**
   * Enables saving only when something actually changed.
   *
   * A disabled button is the cheapest honest answer to "did my edit register?", and it keeps a
   * reflex click from rewriting `settings.json` for nothing.
   */
  private markDirty(): void {
    const changed = this.draft !== null && JSON.stringify(this.draft) !== this.original;
    this.saveButton.disabled = !changed;
    this.dirtyLabel.textContent = changed ? 'Modifications non enregistrées' : '';
  }

  /** Applies a change to the working copy. Nothing here touches the app. */
  private edit(change: (draft: AppSettings) => void): void {
    if (this.draft === null) {
      return;
    }
    change(this.draft);
    this.markDirty();
  }

  /* --------------------------------------------------------------- sections */

  private windowSection(): HTMLElement {
    const draft = this.require();
    const section = createSection('Fenêtre');
    section.append(
      textField({
        label: 'Raccourci global',
        value: draft.globalShortcut,
        hint: 'Accélérateur Electron, par exemple Control+Alt+Space. Un raccourci refusé par le système revient au précédent.',
        onCommit: (value) => this.edit((d) => (d.globalShortcut = value)),
      }),
      checkboxField({
        label: 'Toujours au premier plan',
        checked: draft.alwaysOnTop,
        onChange: (checked) => this.edit((d) => (d.alwaysOnTop = checked)),
      }),
      checkboxField({
        label: 'Masquer quand la fenêtre perd le focus',
        checked: draft.hideOnBlur,
        hint: 'Désactivé par défaut : une popup qui disparaît pendant une pause de réflexion est plus gênante qu’une fenêtre en trop.',
        onChange: (checked) => this.edit((d) => (d.hideOnBlur = checked)),
      }),
      checkboxField({
        label: 'Lancer à l’ouverture de session',
        checked: draft.openAtLogin,
        hint: 'Démarre masqué, la fenêtre arrive au raccourci global.',
        onChange: (checked) => this.edit((d) => (d.openAtLogin = checked)),
      }),
    );
    return section;
  }

  private editorSection(): HTMLElement {
    const draft = this.require();
    const section = createSection('Éditeur');
    section.append(
      numberField({
        label: 'Taille du texte',
        value: draft.fontSize,
        min: 10,
        max: 32,
        step: 1,
        onCommit: (value) => this.edit((d) => (d.fontSize = value)),
      }),
      selectField({
        label: 'Thème',
        value: draft.themeMode,
        options: [
          ['light', 'Clair'],
          ['dark', 'Sombre'],
          ['system', 'Système'],
        ],
        onChange: (value) =>
          this.edit((d) => {
            d.themeMode = value === 'light' || value === 'dark' ? value : 'system';
          }),
      }),
    );
    return section;
  }

  private claudeSection(presets: readonly RewritePreset[]): HTMLElement {
    const draft = this.require();
    const section = createSection('Claude');
    section.append(
      textField({
        label: 'Modèle par défaut',
        value: draft.model,
        hint: 'Alias ou nom complet, utilisé par toute action sans modèle propre.',
        onCommit: (value) => this.edit((d) => (d.model = value)),
      }),
      textField({
        label: 'Chemin du CLI',
        value: draft.claudePath,
        placeholder: 'Détection automatique',
        hint: 'Vide : recherche dans le PATH, puis dans le dossier d’installation par défaut.',
        onCommit: (value) => this.edit((d) => (d.claudePath = value)),
      }),
      numberField({
        label: 'Budget par réécriture (USD)',
        value: draft.maxBudgetUsd,
        min: 0.01,
        max: 20,
        step: 0.05,
        onCommit: (value) => this.edit((d) => (d.maxBudgetUsd = value)),
      }),
      this.modelsByAction(presets),
    );
    return section;
  }

  /**
   * One model field per action.
   *
   * The list comes from the merged presets, so a preset declared in `settings.json` gets a field
   * too. An empty field is not a missing value, it is "follow the default", which the placeholder
   * spells out: proofreading does not need the model that restructuring benefits from.
   */
  private modelsByAction(presets: readonly RewritePreset[]): HTMLElement {
    const draft = this.require();
    const group = createElement('div', { className: 'settings-group' });
    group.append(
      createElement('div', { className: 'settings-group__title', text: 'Modèle par action' }),
      createElement('p', {
        className: 'settings-field__hint',
        text: 'Vide : l’action utilise le modèle par défaut ci-dessus.',
      }),
    );

    for (const preset of presets) {
      group.append(
        textField({
          label: preset.label,
          value: draft.modelByPresetId[preset.id] ?? '',
          placeholder: draft.model,
          onCommit: (value) =>
            this.edit((d) => {
              // Deleting rather than storing an empty string keeps "no override" to a single
              // representation, which is what makes the fallback to the default predictable.
              if (value.trim().length > 0) {
                d.modelByPresetId[preset.id] = value.trim();
              } else {
                delete d.modelByPresetId[preset.id];
              }
            }),
        }),
      );
    }
    return group;
  }

  private storageSection(defaults: Readonly<Record<LibraryId, string>>): HTMLElement {
    const draft = this.require();
    const section = createSection('Dossiers');
    section.append(
      this.directoryField({
        label: 'Dossier des notes',
        value: draft.notesDirectory,
        placeholder: defaults.notes,
        apply: (path) => this.edit((d) => (d.notesDirectory = path)),
      }),
      this.directoryField({
        label: 'Dossier de la bibliothèque de prompts',
        value: draft.promptsDirectory,
        placeholder: defaults.prompts,
        apply: (path) => this.edit((d) => (d.promptsDirectory = path)),
      }),
    );
    return section;
  }

  /** A path field with a native picker beside it. */
  private directoryField(options: {
    label: string;
    value: string;
    placeholder: string;
    apply: (path: string) => void;
  }): HTMLElement {
    const field = textField({
      label: options.label,
      value: options.value,
      placeholder: options.placeholder,
      hint: 'Chemin absolu. Changer de dossier ne déplace pas ce qui est déjà enregistré : les fichiers restent dans l’ancien, qui n’est pas modifié.',
      onCommit: options.apply,
    });

    const input = field.querySelector('input');
    const browse = createElement('button', { className: 'button', text: 'Parcourir…' });
    browse.type = 'button';
    browse.addEventListener('click', () => {
      void this.callbacks.onPickDirectory(input?.value ?? '').then((picked) => {
        if (picked === null || input === null) {
          return;
        }
        input.value = picked;
        options.apply(picked);
      });
    });

    // The button sits next to the input, above the hint, so the warning stays readable.
    input?.parentElement?.append(browse);
    return field;
  }

  /** The working copy, which every section builder runs against. */
  private require(): AppSettings {
    if (this.draft === null) {
      throw new Error('Settings page rendered without a working copy');
    }
    return this.draft;
  }
}

/* ------------------------------------------------------------------ fields */

function createSection(title: string): HTMLElement {
  const section = createElement('section', { className: 'settings-section' });
  section.append(createElement('h2', { className: 'settings-section__title', text: title }));
  return section;
}

function fieldShell(label: string, hint?: string): { field: HTMLElement; row: HTMLElement } {
  const field = createElement('div', { className: 'settings-field' });
  field.append(createElement('label', { className: 'settings-field__label', text: label }));
  const row = createElement('div', { className: 'settings-field__row' });
  field.append(row);
  if (hint !== undefined) {
    field.append(createElement('p', { className: 'settings-field__hint', text: hint }));
  }
  return { field, row };
}

/**
 * A text field that reports on `change`, not on `input`.
 *
 * Per-keystroke reporting would mark the page dirty on the way through every intermediate value,
 * so leaving a field exactly as it was found would still light up the save button.
 */
function textField(options: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onCommit: (value: string) => void;
}): HTMLElement {
  const { field, row } = fieldShell(options.label, options.hint);
  const input = createElement('input', { className: 'settings-input' });
  input.type = 'text';
  input.value = options.value;
  input.spellcheck = false;
  if (options.placeholder !== undefined) {
    input.placeholder = options.placeholder;
  }
  input.addEventListener('change', () => options.onCommit(input.value));
  row.append(input);
  return field;
}

/**
 * A numeric field that only reports a usable value.
 *
 * An empty input reads as `NaN`, and clearing the box before retyping is a normal gesture, so
 * committing on every state would put a broken value in the working copy. The main process
 * clamps the range on save anyway.
 */
function numberField(options: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}): HTMLElement {
  const { field, row } = fieldShell(options.label);
  const input = createElement('input', { className: 'settings-input settings-input--number' });
  input.type = 'number';
  input.value = String(options.value);
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) {
      options.onCommit(parsed);
    }
  });
  row.append(input);
  return field;
}

function selectField(options: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}): HTMLElement {
  const { field, row } = fieldShell(options.label);
  const select = createElement('select', { className: 'select' });
  for (const [value, label] of options.options) {
    const option = createElement('option', { text: label });
    option.value = value;
    select.append(option);
  }
  select.value = options.value;
  select.addEventListener('change', () => options.onChange(select.value));
  row.append(select);
  return field;
}

function checkboxField(options: {
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (checked: boolean) => void;
}): HTMLElement {
  const field = createElement('div', { className: 'settings-field' });
  const label = createElement('label', { className: 'settings-check' });
  const input = createElement('input');
  input.type = 'checkbox';
  input.checked = options.checked;
  input.addEventListener('change', () => options.onChange(input.checked));
  label.append(input, createElement('span', { text: options.label }));
  field.append(label);
  if (options.hint !== undefined) {
    field.append(createElement('p', { className: 'settings-field__hint', text: options.hint }));
  }
  return field;
}
