import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  placeholder,
  rectangularSelection,
} from '@codemirror/view';
import { editorTheme, markdownHighlighting } from './markdown-theme.js';

export interface EditorCallbacks {
  /** Fired on every document change, for autosave and the counters. */
  onChange: (text: string) => void;
}

const PLACEHOLDER_TEXT = `Écris ton prompt ici. Entrée = retour à la ligne.
Ctrl+Entrée copie tout et masque la fenêtre.`;

/**
 * Builds the editor.
 *
 * `basicSetup` is deliberately not used: it brings line numbers, a fold gutter, an
 * autocomplete popup and a lint gutter, all of which belong in a code editor and would turn
 * a writing surface into an IDE. Each extension below is here for a reason.
 *
 * @param parent Host element.
 * @param initialText Draft recovered from disk.
 * @param appKeymap App-level bindings (copy, rewrite, hide), passed in with the highest precedence.
 */
export function createEditor(options: {
  parent: HTMLElement;
  initialText: string;
  fontSize: number;
  appKeymap: Extension;
  callbacks: EditorCallbacks;
}): EditorView {
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.initialText,
      extensions: [
        // App bindings first: they must win over any default sharing a key.
        options.appKeymap,

        // Markdown with per-language fenced-block highlighting. `markdownKeymap` provides
        // list and quote continuation on Enter, which is what makes writing structured
        // prompts bearable.
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
        EditorState.allowMultipleSelections.of(true),

        editorTheme,
        markdownHighlighting,
        fontSizeTheme(options.fontSize),

        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.callbacks.onChange(update.state.doc.toString());
          }
        }),
      ],
    }),
  });

  return view;
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
 * One transaction means one undo step: whatever this writes, `Ctrl+Z` takes back in full.
 * That property is what makes applying a rewrite safe.
 */
export function replaceAll(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    scrollIntoView: true,
  });
}

/** Puts the caret at the end and focuses, for restoring a session. */
export function focusAtEnd(view: EditorView): void {
  view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
  view.focus();
}
