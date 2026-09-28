import type { PresetKind, RewritePreset } from '@shared/contracts.js';
import { appShortcutLabel } from '../editor/shortcuts.js';
import { assignAccessKeys } from './access-keys.js';
import { clearChildren, createElement, requireElement } from './dom.js';

/**
 * Menu groups, in display order. The label says what the preset *produces*.
 *
 * Texts come first: correcting, translating and changing the register are what the app is used
 * for most, and restructuring a prompt is the occasional case.
 */
const PRESET_GROUPS: readonly (readonly [PresetKind, string])[] = [
  ['text', 'Texte'],
  ['agent-prompt', 'Prompt'],
];

export interface PresetMenuOptions {
  /** Runs a preset, from the main button or from an entry of the menu. */
  readonly onRun: (presetId: string) => void;
  /** Called when the selected preset changes, so the choice survives a restart. */
  readonly onSelect: (presetId: string) => void;
}

/**
 * The rewrite split button: the action on the left, the menu of actions on the right.
 *
 * It replaces a "Rédiger le prompt" button beside a `<select>`. That button kept its label
 * whatever the select said, so with "Corriger" chosen it announced a prompt it was not going to
 * write, and running another action took three gestures (open, pick, click). Here the button
 * carries the verb it runs, and picking an entry runs it straight away and makes it the button's
 * action. A native `<select>` cannot do the second half: it only reports a change, and choosing
 * the entry that is already selected fires nothing.
 *
 * Each entry also has a letter, shown at its right: with the menu open, typing it runs the entry.
 * `Ctrl+Maj+R` then `C` corrects in two keys without reaching for the mouse, while `Ctrl+R` keeps
 * running whatever the button shows.
 */
export class PresetMenu {
  private readonly root = requireElement<HTMLDivElement>('rewrite-split');
  private readonly main = requireElement<HTMLButtonElement>('rewrite-button');
  private readonly toggle = requireElement<HTMLButtonElement>('preset-menu-button');
  private readonly menu = requireElement<HTMLDivElement>('preset-menu');
  private presets: readonly RewritePreset[] = [];
  private selectedId = '';
  /** Letter of each preset, by id. A preset left without one is reachable with the arrows. */
  private accessKeys: ReadonlyMap<string, string> = new Map();
  private busy = false;
  /** Where focus was when the menu opened, given back when it closes. */
  private returnFocus: HTMLElement | null = null;

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) {
      this.close({ restoreFocus: false });
    }
  };

  constructor(private readonly options: PresetMenuOptions) {
    this.toggle.title = `Choisir une action et la lancer (${appShortcutLabel('rewritePick')})`;
    this.main.addEventListener('click', () => this.options.onRun(this.selectedId));
    this.toggle.addEventListener('click', () => {
      if (this.isOpen) {
        this.close({ restoreFocus: true });
      } else {
        this.open();
      }
    });
    this.menu.addEventListener('keydown', (event) => this.handleMenuKeydown(event));
  }

  get isOpen(): boolean {
    return !this.menu.hidden;
  }

  /** The preset the main button runs. */
  get selected(): RewritePreset | undefined {
    return this.presets.find((preset) => preset.id === this.selectedId);
  }

  /**
   * Builds the menu and selects the preferred preset.
   *
   * A preferred id that no longer exists (a custom preset removed from `settings.json`) falls back
   * to the first preset, the same fallback the main process applies when it resolves one.
   */
  render(presets: readonly RewritePreset[], preferredId: string): void {
    this.presets = presets;
    this.selectedId = presets.some((preset) => preset.id === preferredId)
      ? preferredId
      : (presets[0]?.id ?? '');

    // Assigned in display order, so a derived letter goes to the entry nearest the top.
    this.accessKeys = assignAccessKeys(
      PRESET_GROUPS.flatMap(([kind]) => presets.filter((preset) => preset.kind === kind)),
    );

    clearChildren(this.menu);
    // A group with no member is skipped rather than rendered empty, so a configuration that
    // drops a whole family leaves no dangling header.
    for (const [kind, groupLabel] of PRESET_GROUPS) {
      const members = presets.filter((preset) => preset.kind === kind);
      if (members.length === 0) {
        continue;
      }
      const group = createElement('div', { className: 'preset-menu__group' });
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', groupLabel);
      const header = createElement('div', { className: 'preset-menu__header', text: groupLabel });
      header.setAttribute('aria-hidden', 'true');
      group.append(header);
      for (const preset of members) {
        group.append(this.renderItem(preset));
      }
      this.menu.append(group);
    }
    this.renderMain();
  }

  /** Opens the menu with focus on the selected entry, so arrows start from where you are. */
  open(): void {
    if (this.busy || this.isOpen || this.presets.length === 0) {
      return;
    }
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.menu.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onOutsidePointer, true);
    const items = this.items();
    (items.find((item) => item.dataset['presetId'] === this.selectedId) ?? items[0])?.focus();
  }

  close({ restoreFocus }: { restoreFocus: boolean }): void {
    if (!this.isOpen) {
      return;
    }
    this.menu.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onOutsidePointer, true);
    const target = this.returnFocus;
    this.returnFocus = null;
    if (restoreFocus && target?.isConnected === true) {
      target.focus();
    }
  }

  /** Locks both halves while a rewrite runs, and says on the button which one is running. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) {
      this.close({ restoreFocus: false });
    }
    this.main.disabled = busy;
    this.toggle.disabled = busy;
    this.renderMain();
  }

  private renderItem(preset: RewritePreset): HTMLButtonElement {
    const item = createElement('button', { className: 'preset-menu__item' });
    item.type = 'button';
    item.tabIndex = -1;
    item.dataset['presetId'] = preset.id;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(preset.id === this.selectedId));
    const text = createElement('span', { className: 'preset-menu__text' });
    text.append(
      createElement('span', { className: 'preset-menu__label', text: preset.label }),
      createElement('span', { className: 'preset-menu__hint', text: preset.hint }),
    );
    item.append(text);
    const key = this.accessKeys.get(preset.id);
    if (key !== undefined) {
      item.setAttribute('aria-keyshortcuts', key.toUpperCase());
      const cap = createElement('kbd', { className: 'preset-menu__key', text: key.toUpperCase() });
      cap.setAttribute('aria-hidden', 'true');
      item.append(cap);
    }
    item.addEventListener('click', () => this.pick(preset.id));
    return item;
  }

  private pick(presetId: string): void {
    if (presetId !== this.selectedId) {
      this.selectedId = presetId;
      for (const item of this.items()) {
        item.setAttribute('aria-checked', String(item.dataset['presetId'] === presetId));
      }
      this.renderMain();
      this.options.onSelect(presetId);
    }
    this.close({ restoreFocus: true });
    this.options.onRun(presetId);
  }

  private renderMain(): void {
    const preset = this.selected;
    const label = preset?.label ?? 'Réécrire';
    this.main.textContent = this.busy ? `${label}…` : label;
    this.main.title =
      preset === undefined ? '' : `${preset.hint} (${appShortcutLabel('rewriteDefault')})`;
  }

  /**
   * Arrow keys move between entries, Home and End jump to the ends, Escape and Tab leave, and an
   * entry's letter runs it.
   *
   * Escape is marked as handled so the window-level handler, which would otherwise close a panel
   * or hide the window, lets it through untouched. Tab is not: focus is meant to move on.
   */
  private handleMenuKeydown(event: KeyboardEvent): void {
    const items = this.items();
    const current = items.findIndex((item) => item === document.activeElement);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % items.length;
        break;
      case 'ArrowUp':
        next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        this.close({ restoreFocus: true });
        return;
      case 'Tab':
        this.close({ restoreFocus: false });
        return;
      default: {
        // Ctrl, Alt and Cmd combinations are left to the app: `Ctrl+C` in an open menu is not
        // a request to correct. Shift is tolerated, since caps lock or a held Shift still means
        // the same letter.
        if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) {
          return;
        }
        const wanted = event.key.toLowerCase();
        const match = [...this.accessKeys].find(([, key]) => key === wanted);
        if (match !== undefined) {
          event.preventDefault();
          this.pick(match[0]);
        }
        return;
      }
    }
    event.preventDefault();
    items[next]?.focus();
  }

  private items(): HTMLButtonElement[] {
    return [...this.menu.querySelectorAll<HTMLButtonElement>('.preset-menu__item')];
  }
}
