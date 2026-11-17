import type { LibraryEntry } from '@shared/contracts.js';
import { createElement } from './dom.js';

/** What a card offers. */
export interface LibraryCardActions {
  /** Load into the editor. Also what a click on the card itself does. */
  readonly onLoad: (entry: LibraryEntry) => void;
  /** Copy to the clipboard, leaving the draft alone. */
  readonly onCopy: (entry: LibraryEntry) => void;
  /** Replace the entry with the current draft, behind the two-step confirmation below. */
  readonly onOverwrite: (entry: LibraryEntry) => void;
  /** Delete the entry, behind the two-step confirmation below. */
  readonly onDelete: (entry: LibraryEntry) => void;
}

/** How long a destructive button stays armed before falling back to its safe label. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * Renders the library as a grid of cards.
 *
 * A card is not a single button: it carries four actions, and nesting buttons inside a button is
 * invalid HTML that browsers resolve unpredictably. The title and preview form the clickable part,
 * the tools sit below it.
 */
export function renderLibraryGrid(
  entries: readonly LibraryEntry[],
  actions: LibraryCardActions,
): HTMLElement {
  const grid = createElement('div', { className: 'library-grid' });
  for (const entry of entries) {
    grid.append(libraryCard(entry, actions));
  }
  return grid;
}

/** Empty state, worded so the way to create the first entry is visible from here. */
export function renderLibraryEmpty(message: string, directory: string): HTMLElement {
  const wrapper = createElement('div', { className: 'history-empty' });
  wrapper.append(
    createElement('p', { text: message }),
    createElement('p', { className: 'library-empty__path', text: directory }),
  );
  return wrapper;
}

function libraryCard(entry: LibraryEntry, actions: LibraryCardActions): HTMLElement {
  const card = createElement('div', { className: 'library-card' });

  const open = createElement('button', {
    className: 'library-card__open',
    title: `Charger dans l’éditeur · ${entry.id}`,
  });
  open.type = 'button';
  open.append(createElement('span', { className: 'library-card__title', text: entry.title }));
  if (entry.excerpt.length > 0) {
    open.append(createElement('span', { className: 'library-card__excerpt', text: entry.excerpt }));
  }
  open.addEventListener('click', () => actions.onLoad(entry));

  const tools = createElement('div', { className: 'library-card__tools' });
  const primary = createElement('div', { className: 'library-card__primary' });
  primary.append(
    quietButton('Copier', 'Copier dans le presse-papier, sans toucher au brouillon', () =>
      actions.onCopy(entry),
    ),
    quietButton('Charger', 'Charger dans l’éditeur, le brouillon actuel est archivé', () =>
      actions.onLoad(entry),
    ),
  );
  const secondary = createElement('div', { className: 'library-card__secondary' });
  secondary.append(
    confirmButton({
      label: 'Remplacer',
      armedLabel: 'Confirmer',
      title: 'Remplacer le contenu par le brouillon actuel',
      onConfirm: () => actions.onOverwrite(entry),
    }),
    confirmButton({
      label: 'Supprimer',
      armedLabel: 'Confirmer',
      title: 'Supprimer définitivement cette entrée',
      onConfirm: () => actions.onDelete(entry),
    }),
  );
  tools.append(primary, secondary);

  card.append(open, tools);
  return card;
}

function quietButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = createElement('button', { className: 'button button--quiet', text: label, title });
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

/**
 * A button that needs two clicks.
 *
 * Preferred over a native dialog: `dialog.showMessageBox` on a window that is always on top is
 * more intrusive than the action it guards, and a modal blocks every other interaction. Two
 * clicks with a visible label change is enough against the accidental one, and the arming
 * expires so a button left armed does not fire on a click made minutes later for another reason.
 */
export function confirmButton(options: {
  label: string;
  armedLabel: string;
  title?: string;
  onConfirm: () => void;
}): HTMLButtonElement {
  const button = createElement('button', { className: 'button button--quiet', text: options.label });
  button.type = 'button';
  if (options.title !== undefined) {
    button.title = options.title;
  }

  let timer: number | null = null;
  const disarm = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    button.textContent = options.label;
    button.classList.remove('button--armed');
  };

  button.addEventListener('click', () => {
    if (timer !== null) {
      disarm();
      options.onConfirm();
      return;
    }
    button.textContent = options.armedLabel;
    button.classList.add('button--armed');
    timer = window.setTimeout(disarm, CONFIRM_WINDOW_MS);
  });

  return button;
}
