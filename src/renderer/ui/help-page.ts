import {
  acceleratorLabel,
  APP_SHORTCUTS,
  EDITOR_SHORTCUTS,
  FORMAT_SHORTCUTS,
  shortcutLabel,
  WINDOW_SHORTCUTS,
} from '../editor/shortcuts.js';
import { createElement, requireElement } from './dom.js';

/** One row: the keys on the left, what they do on the right. */
interface Row {
  readonly key: string;
  readonly label: string;
}

/** A titled block of rows. */
interface Section {
  readonly title: string;
  readonly rows: readonly Row[];
  /** Shown under the title when the grouping itself needs a word of explanation. */
  readonly note?: string;
}

export interface HelpPageCallbacks {
  /** Fired on close, whichever way it was closed, so the caller can restore its chrome. */
  readonly onClose: () => void;
}

/**
 * The shortcut reference.
 *
 * Every row is derived from the tables in `editor/shortcuts.ts`, the same ones the keymap is
 * built from, so this page cannot list a key the app does not install. Only the global
 * accelerator is passed in: it is configurable, so the settings are its source of truth.
 *
 * Built with `createElement` and never `innerHTML`, like every other surface in this renderer.
 * Nothing here is user text today, but the rule is what keeps that true as the page grows.
 */
export class HelpPage {
  private readonly root = requireElement<HTMLElement>('help-page');
  private readonly body = requireElement<HTMLDivElement>('help-page-body');
  private readonly closeButton = requireElement<HTMLButtonElement>('help-close');

  private open = false;

  constructor(private readonly callbacks: HelpPageCallbacks) {
    this.closeButton.addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Renders the reference and shows it.
   *
   * @param globalShortcut The accelerator currently registered with the OS, which may be the
   * fallback rather than the configured one. Printing the configured value would be a lie in
   * exactly the case where the user is looking for an explanation.
   */
  show(globalShortcut: string): void {
    this.body.replaceChildren(...sections(globalShortcut).map(renderSection));
    this.open = true;
    this.root.hidden = false;
    this.body.scrollTop = 0;
    // The page is scrollable and has no field to type in, so focus goes to the container itself:
    // PageDown and the arrows have to work without a click first.
    this.body.focus();
  }

  close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.root.hidden = true;
    this.body.replaceChildren();
    this.callbacks.onClose();
  }
}

/** The page content, in reading order: what you press most often comes first. */
function sections(globalShortcut: string): readonly Section[] {
  return [
    {
      title: 'Depuis n’importe quelle application',
      // Empty when the OS refused every accelerator, in which case the tray icon is the only way
      // back and a row printing nothing would be the least helpful thing on the page.
      rows:
        globalShortcut.length > 0
          ? [{ key: globalShortcut, label: 'Afficher ou masquer la fenêtre' }]
          : [],
      note:
        globalShortcut.length > 0
          ? 'Modifiable dans les réglages. Si le système refuse la combinaison, l’app se rabat sur une autre, et c’est celle affichée ici.'
          : 'Aucun raccourci global n’a pu être enregistré : le système les refuse tous. L’icône de la zone de notification reste le moyen d’ouvrir la fenêtre.',
    },
    {
      title: 'Actions',
      rows: APP_SHORTCUTS.map(toRow),
    },
    {
      title: 'Document',
      rows: WINDOW_SHORTCUTS.map(toRow),
      note: 'Actifs même dans l’aperçu, où l’éditeur n’a pas le focus. Ignorés tant que les réglages sont ouverts.',
    },
    {
      title: 'Mise en forme Markdown',
      rows: FORMAT_SHORTCUTS.map(toRow),
    },
    {
      title: 'Édition',
      rows: EDITOR_SHORTCUTS.map(toRow),
      note: 'Fournis par CodeMirror. Sur un clavier suisse romand, Ctrl+Maj+7 arrive en Ctrl+/ et bascule les commentaires : c’est pourquoi aucun raccourci de l’app n’utilise un chiffre avec Maj.',
    },
  ];
}

function toRow(shortcut: { readonly key: string; readonly label: string }): Row {
  return { key: shortcut.key, label: shortcut.label };
}

function renderSection(section: Section): HTMLElement {
  const element = createElement('section', { className: 'help-section' });
  element.append(createElement('h2', { className: 'help-section__title', text: section.title }));

  if (section.note !== undefined) {
    element.append(createElement('p', { className: 'help-section__note', text: section.note }));
  }

  const list = createElement('dl', { className: 'help-list' });
  for (const row of section.rows) {
    const term = createElement('dt', { className: 'help-list__keys' });
    term.append(renderKeys(row.key));
    list.append(term, createElement('dd', { className: 'help-list__label', text: row.label }));
  }
  element.append(list);
  return element;
}

/**
 * Splits a shortcut into one `<kbd>` per key.
 *
 * Separate caps rather than one `Ctrl+Maj+D` string: the plus signs are the visual noise that
 * makes a long list of combinations hard to scan, and a cap per key is what every reference this
 * page competes with looks like.
 */
function renderKeys(key: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = (key.includes('+') ? acceleratorLabel(key) : shortcutLabel(key)).split('+');
  parts.forEach((part, index) => {
    if (index > 0) {
      fragment.append(createElement('span', { className: 'help-list__plus', text: '+' }));
    }
    fragment.append(createElement('kbd', { className: 'kbd', text: part }));
  });
  return fragment;
}
