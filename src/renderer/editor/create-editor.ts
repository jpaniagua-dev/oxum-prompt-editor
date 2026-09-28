import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  placeholder,
  rectangularSelection,
} from '@codemirror/view';
import { editorThemeFor, markdownHighlighting } from './markdown-theme.js';

export interface EditorCallbacks {
  /** Fired on every document change, for autosave and the counters. */
  onChange: (text: string) => void;
}

const PLACEHOLDER_TEXT = `Écris ou colle ton texte ici. Entrée = retour à la ligne.
Ctrl+Entrée copie tout et masque la fenêtre.`;

/** Holds the per-theme extension so it can be swapped without rebuilding the editor. */
const themeCompartment = new Compartment();

/** Holds the font size so a settings change does not require recreating the state. */
const fontCompartment = new Compartment();

/**
 * Builds the editor.
 *
 * `basicSetup` is deliberately not used: it brings line numbers, a fold gutter, an autocomplete
 * popup and a lint gutter, all of which belong in a code editor and would turn a writing surface
 * into an IDE. Each extension below is here for a reason.
 *
 * @param appKeymap App-level bindings (copy, rewrite, formatting), given the highest precedence.
 */
export function createEditor(options: {
  parent: HTMLElement;
  initialText: string;
  fontSize: number;
  dark: boolean;
  appKeymap: Extension;
  callbacks: EditorCallbacks;
}): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.initialText,
      extensions: [
        // The app's bindings must win over every extension default. Array order is NOT enough:
        // `searchKeymap` also claims `Mod-Shift-l` (and `Mod-d`, `Mod-f`, `Mod-g`), and it was
        // observed swallowing the task-list shortcut even with this keymap listed first.
        // `Prec.highest` is the documented way to state the priority explicitly.
        Prec.highest(options.appKeymap),

        // Markdown with per-language fenced-block highlighting. `markdownKeymap` provides list
        // and quote continuation on Enter, which is what makes writing structured prompts
        // bearable.
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
        keymap.of(markdownKeymap),

        history(),
        keymap.of([...historyKeymap, ...searchKeymap, ...defaultKeymap, indentWithTab]),

        // Soft wrap: prompts are prose, so a horizontal scrollbar would be a bug.
        EditorView.lineWrapping,
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        search({ top: true }),
        indentUnit.of('  '),
        placeholder(PLACEHOLDER_TEXT),
        // Required for multi-cursor formatting: without it a state keeps only its main range.
        EditorState.allowMultipleSelections.of(true),

        themeCompartment.of(editorThemeFor(options.dark)),
        fontCompartment.of(fontSizeTheme(options.fontSize)),
        markdownHighlighting,

        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.callbacks.onChange(update.state.doc.toString());
          }
        }),
      ],
    }),
  });
}

/** Swaps the editor's light/dark base theme in place, preserving document and undo history. */
export function applyEditorTheme(view: EditorView, dark: boolean): void {
  view.dispatch({ effects: themeCompartment.reconfigure(editorThemeFor(dark)) });
}

/** Applies a new font size without touching the document. */
export function applyEditorFontSize(view: EditorView, fontSize: number): void {
  view.dispatch({ effects: fontCompartment.reconfigure(fontSizeTheme(fontSize)) });
}

/** Theme fragment carrying the configurable font size. */
function fontSizeTheme(fontSize: number): Extension {
  return EditorView.theme({
    '&': { fontSize: `${fontSize}px` },
  });
}

/** Current document text. */
export function getText(view: EditorView): string {
  return view.state.doc.toString();
}

/**
 * Replaces the whole document in a single transaction.
 *
 * One transaction means one undo step: whatever this writes, `Ctrl+Z` takes back in full. That
 * property is what makes applying a rewrite safe.
 *
 * The text is converted through `toText` before anything is measured, because the conversion is
 * not length-preserving: CodeMirror stores one line break per line, so every `\r\n` in the input
 * becomes a single character in the document. Deriving the caret position from `text.length`
 * therefore put it past the end of a CRLF document, and the transaction was rejected outright
 * with "Selection points outside of document". Everything the app wrote itself used `\n`, so the
 * first text to trigger it was a file opened from disk on Windows.
 */
export function replaceAll(view: EditorView, text: string): void {
  const insert = view.state.toText(text);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert },
    selection: { anchor: insert.length },
    scrollIntoView: true,
  });
}

/**
 * Replaces one range in a single transaction and selects what was inserted.
 *
 * Same single-undo-step guarantee as {@link replaceAll}, and the same measuring rule: the new
 * selection is derived from the converted text, not from the raw string. Selecting the result
 * rather than parking the caret lets the next action run on it straight away, which is how a
 * paragraph gets corrected and then translated.
 */
export function replaceRange(view: EditorView, from: number, to: number, text: string): void {
  const insert = view.state.toText(text);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from, head: from + insert.length },
    scrollIntoView: true,
  });
}

/** Puts the caret at the end and focuses, for restoring a session. */
export function focusAtEnd(view: EditorView): void {
  view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
  view.focus();
}
