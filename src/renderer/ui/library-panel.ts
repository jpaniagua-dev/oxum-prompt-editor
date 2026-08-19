import type { LibraryEntry } from '@shared/contracts.js';
import { createElement } from './dom.js';
import { formatTimestamp } from './format.js';

/**
 * What a row offers, which is where the two libraries differ.
 *
 * Notes are working documents, so activating one loads it into the editor and replacing it with
 * the draft makes sense. Prompts are reusable material, so activating one copies it to the
 * clipboard and leaves the draft alone, which is the whole point of keeping them apart.
 *
 * `onOverwrite` is nullable rather than optional: with `exactOptionalPropertyTypes`, an absent
 * key and an undefined one are different types, and a null reads the same at both call sites.
 */
export interface LibraryRowActions {
  /** What clicking the row does. */
  readonly onActivate: (entry: LibraryEntry) => void;
  /** Tooltip on the row, saying what the click will do. */
  readonly activateHint: string;
  /** Replace the entry with the current draft, when the library supports it. */
  readonly onOverwrite: ((entry: LibraryEntry) => void) | null;
  /** Delete the entry, behind the two-step confirmation below. */
  readonly onDelete: (entry: LibraryEntry) => void;
}

/** How long a destructive button stays armed before falling back to its safe label. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * Renders one library as a list.
 *
 * The whole row is not a single button, unlike the history list: a row carries two or three
 * actions, and nesting buttons inside a button is invalid HTML that browsers resolve
 * unpredictably. The title is the clickable part, the rest sits beside it.
 */
export function renderLibraryList(
  entries: readonly LibraryEntry[],
  actions: LibraryRowActions,
): HTMLElement {
  const list = createElement('div', { className: 'notes-list' });
  for (const entry of entries) {
    list.append(libraryRow(entry, actions));
  }
  return list;
}

/** Empty state, worded so the way to create the first entry is visible from here. */
export function renderLibraryEmpty(message: string, directory: string): HTMLElement {
  const wrapper = createElement('div', { className: 'history-empty' });
  wrapper.append(
    createElement('p', { text: message }),
    createElement('p', { className: 'notes-empty__path', text: directory }),
  );
  return wrapper;
}

function libraryRow(entry: LibraryEntry, actions: LibraryRowActions): HTMLElement {
  const row = createElement('div', { className: 'note-item' });

  const activate = createElement('button', {
    className: 'note-item__open',
    title: `${actions.activateHint} · ${entry.id}`,
  });
  activate.type = 'button';
  activate.append(
    createElement('span', { className: 'note-item__title', text: entry.title }),
    createElement('span', {
      className: 'note-item__meta',
      text: `${formatTimestamp(entry.updatedAt)} · ${entry.size} car.`,
    }),
  );
  activate.addEventListener('click', () => actions.onActivate(entry));

  const tools = createElement('div', { className: 'note-item__tools' });
  const overwrite = actions.onOverwrite;
  if (overwrite !== null) {
    tools.append(
      confirmButton({
        label: 'Remplacer',
        armedLabel: 'Confirmer',
        title: 'Remplacer le contenu par le brouillon actuel',
        onConfirm: () => overwrite(entry),
      }),
    );
  }
  tools.append(
    confirmButton({
      label: 'Supprimer',
      armedLabel: 'Confirmer',
      title: 'Supprimer définitivement cette entrée',
      onConfirm: () => actions.onDelete(entry),
    }),
  );

  row.append(activate, tools);
  return row;
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

