import type { MarkdownCommandId } from './markdown-commands.js';

/**
 * Every keyboard binding the app declares, as data.
 *
 * This module is the single source: the CodeMirror keymap, the window-level handler and the help
 * panel all read these tables rather than each carrying their own copy. A help panel listing
 * shortcuts it does not itself install is a document, and documents drift; here a binding without
 * a label does not compile, and a test checks the reverse direction.
 *
 * Deliberately free of any `@codemirror/*` value import, so the tables stay loadable in a plain
 * Node test with no DOM.
 */

/** App-level commands, i.e. everything that is not a Markdown edit. */
export type AppCommandId =
  | 'copyAndHide'
  | 'copyOnly'
  | 'rewriteDefault'
  | 'rewritePick'
  | 'newDraft'
  | 'toggleLibrary'
  | 'showNotes'
  | 'showHistory'
  | 'toggleSettings'
  | 'toggleHelp'
  | 'cycleTheme'
  | 'escape';

/** Commands bound on the window rather than in the editor. See {@link WINDOW_SHORTCUTS}. */
export type WindowCommandId = 'togglePreview' | 'openFile';

export interface Shortcut<T> {
  /** CodeMirror key notation, e.g. `Mod-Shift-d`. `Mod` is Ctrl on Windows. */
  readonly key: string;
  /** What it does, in the user's language. Shown in the help panel. */
  readonly label: string;
  readonly command: T;
}

/**
 * App bindings, installed as a CodeMirror keymap under `Prec.highest()`.
 *
 * The important one is what is *absent*: `Enter` is never bound to a submit action. In a terminal
 * REPL, Enter sends and getting a newline is the awkward part; here it is the reverse, which is
 * precisely the friction this app removes. `Ctrl+Enter` is the send-ish gesture, and it only ever
 * copies.
 */
export const APP_SHORTCUTS: readonly Shortcut<AppCommandId>[] = [
  { key: 'Mod-Enter', label: 'Copier tout et masquer la fenêtre', command: 'copyAndHide' },
  { key: 'Mod-Shift-Enter', label: 'Copier sans masquer', command: 'copyOnly' },
  { key: 'Mod-r', label: 'Lancer l’action affichée sur le bouton', command: 'rewriteDefault' },
  { key: 'Mod-Shift-r', label: 'Choisir une action et la lancer', command: 'rewritePick' },
  { key: 'Mod-n', label: 'Nouveau brouillon (l’actuel est archivé)', command: 'newDraft' },
  // `Mod-l` opens the panel itself; the other two land straight on a tab, so the direct access
  // the three separate toolbar buttons used to give is not lost with them.
  { key: 'Mod-l', label: 'Bibliothèque, sur le dernier onglet ouvert', command: 'toggleLibrary' },
  { key: 'Mod-h', label: 'Historique des instantanés', command: 'showHistory' },
  { key: 'Mod-m', label: 'Notes', command: 'showNotes' },
  // `Mod-,` rather than a digit: the comma is unshifted on a Swiss/French layout, so it does not
  // go through the same mangling that makes `Ctrl+Shift+7` arrive as `Ctrl+/`.
  { key: 'Mod-,', label: 'Réglages', command: 'toggleSettings' },
  { key: 'Mod-Shift-d', label: 'Thème : clair, sombre, système', command: 'cycleTheme' },
  // F1 rather than a `Mod-` combination: it is the one help key every Windows app agrees on, no
  // layout mangles it, and neither `defaultKeymap` nor `searchKeymap` claims it.
  { key: 'F1', label: 'Aide : cette liste', command: 'toggleHelp' },
  { key: 'Escape', label: 'Fermer le panneau ouvert, sinon masquer la fenêtre', command: 'escape' },
];

/**
 * Bindings that must work even when the editor does not have focus.
 *
 * They live on the document rather than in the keymap because the preview *replaces* the editor:
 * while it is on screen the editor container is `display:none` and no CodeMirror view would ever
 * see the key. They are written `Mod-x` all the same, so one label formatter serves every table.
 */
export const WINDOW_SHORTCUTS: readonly Shortcut<WindowCommandId>[] = [
  { key: 'Mod-p', label: 'Aperçu Markdown, à la place de l’éditeur', command: 'togglePreview' },
  { key: 'Mod-o', label: 'Ouvrir un fichier Markdown du disque', command: 'openFile' },
];

/**
 * Markdown formatting.
 *
 * The list bindings use **letters** (u/n/t) rather than the digits the Google Docs convention
 * would suggest, because digit shortcuts are layout dependent: on a Swiss/French keyboard
 * `Shift+7` is physically the `/` key, so `Ctrl+Shift+7` arrives as `Ctrl+/` and gets claimed by
 * CodeMirror's comment toggle. Letters resolve identically on every layout.
 *
 * None collide with {@link APP_SHORTCUTS} or {@link WINDOW_SHORTCUTS}, which a test enforces.
 */
export const FORMAT_SHORTCUTS: readonly Shortcut<MarkdownCommandId>[] = [
  { key: 'Mod-b', label: 'Gras', command: 'bold' },
  { key: 'Mod-i', label: 'Italique', command: 'italic' },
  { key: 'Mod-e', label: 'Code inline', command: 'code' },
  { key: 'Mod-Shift-x', label: 'Barré', command: 'strikethrough' },
  { key: 'Mod-1', label: 'Titre 1', command: 'h1' },
  { key: 'Mod-2', label: 'Titre 2', command: 'h2' },
  { key: 'Mod-3', label: 'Titre 3', command: 'h3' },
  { key: 'Mod-Shift-u', label: 'Liste à puces', command: 'bulletList' },
  // Not `Mod-Shift-o`: Chromium claims it for its bookmark manager and it never reaches the
  // renderer, verified by the toolbar button working while the shortcut did nothing.
  { key: 'Mod-Shift-n', label: 'Liste numérotée', command: 'orderedList' },
  { key: 'Mod-Shift-t', label: 'Case à cocher', command: 'taskList' },
  { key: 'Mod-Shift-.', label: 'Citation', command: 'quote' },
  { key: 'Mod-Shift-c', label: 'Bloc de code', command: 'codeBlock' },
  { key: 'Mod-k', label: 'Lien', command: 'link' },
];

/**
 * Keys the app does not install but inherits from CodeMirror.
 *
 * Listed by hand, and that is a knowing exception to this module's rule: they come from
 * `historyKeymap`, `searchKeymap` and `defaultKeymap`, which expose no table to read. Kept short
 * on purpose: the point is to answer "can I undo, search, comment", not to mirror upstream.
 */
export const EDITOR_SHORTCUTS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'Mod-z', label: 'Annuler' },
  { key: 'Mod-y', label: 'Rétablir' },
  { key: 'Mod-f', label: 'Rechercher dans le brouillon' },
  { key: 'Mod-g', label: 'Occurrence suivante' },
  { key: 'Mod-d', label: 'Ajouter un curseur sur l’occurrence suivante' },
  { key: 'Mod-/', label: 'Commenter ou décommenter' },
  { key: 'Alt-ArrowUp', label: 'Déplacer la ligne vers le haut' },
  { key: 'Alt-ArrowDown', label: 'Déplacer la ligne vers le bas' },
];

/** How a modifier reads in the UI, which is French and Windows. */
const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Control: 'Ctrl',
  Cmd: 'Cmd',
  Meta: 'Cmd',
  Shift: 'Maj',
  Alt: 'Alt',
};

/** Named keys that would otherwise render as their raw DOM name. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  Enter: 'Entrée',
  Escape: 'Échap',
  Space: 'Espace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/**
 * Renders a key notation for display: `Mod-Shift-d` becomes `Ctrl+Maj+D`.
 *
 * Single characters are upper-cased, because a lowercase `b` in a tooltip reads as a letter to
 * type rather than as the key cap it names.
 */
export function shortcutLabel(key: string): string {
  const parts = key.split('-');
  return parts
    .map((part, index) => {
      if (index < parts.length - 1) {
        return MODIFIER_LABELS[part] ?? part;
      }
      return KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part);
    })
    .join('+');
}

/**
 * Renders an Electron accelerator the same way, e.g. `Control+Alt+Space` as `Ctrl+Alt+Espace`.
 *
 * The global shortcut is configurable, so the help panel reads it from the settings rather than
 * from a table, and it arrives in Electron's `+` notation instead of CodeMirror's `-`.
 */
export function acceleratorLabel(accelerator: string): string {
  return shortcutLabel(accelerator.split('+').join('-'));
}

/** Display label of a formatting shortcut, for the toolbar tooltips. */
export function formatShortcutLabel(command: MarkdownCommandId): string {
  const shortcut = FORMAT_SHORTCUTS.find((entry) => entry.command === command);
  return shortcut === undefined ? '' : shortcutLabel(shortcut.key);
}

/** Display label of an app shortcut, for the tooltips of the controls that run the same command. */
export function appShortcutLabel(command: AppCommandId): string {
  const shortcut = APP_SHORTCUTS.find((entry) => entry.command === command);
  return shortcut === undefined ? '' : shortcutLabel(shortcut.key);
}

/** Display label of a formatting command, so the toolbar and the help panel cannot disagree. */
export function formatCommandLabel(command: MarkdownCommandId): string {
  return FORMAT_SHORTCUTS.find((entry) => entry.command === command)?.label ?? '';
}

/**
 * Resolves a raw `KeyboardEvent.key` against {@link WINDOW_SHORTCUTS}.
 *
 * The caller has already established that the Ctrl/Cmd modifier is held and that no other one is,
 * so only the final segment matters here.
 */
export function windowCommandFor(eventKey: string): WindowCommandId | null {
  const wanted = eventKey.toLowerCase();
  for (const shortcut of WINDOW_SHORTCUTS) {
    const parts = shortcut.key.split('-');
    if ((parts[parts.length - 1] ?? '').toLowerCase() === wanted) {
      return shortcut.command;
    }
  }
  return null;
}
