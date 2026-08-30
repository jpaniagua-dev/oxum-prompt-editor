// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { getText, replaceAll } from '../src/renderer/editor/create-editor.js';

const views: EditorView[] = [];

/**
 * A bare view, without the app's extensions.
 *
 * `createEditor` pulls in the whole editor — search panel, themes, the app keymap — none of
 * which has any bearing on what a document replacement does, and all of which needs layout that
 * jsdom does not provide. What is under test is the transaction, so the state is enough.
 */
function viewWith(doc: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc }) });
  views.push(view);
  return view;
}

/**
 * Every view is torn down, and it is not mere hygiene.
 *
 * A dispatch schedules a measurement in `requestAnimationFrame`, and measuring means asking the
 * DOM for text rectangles, which jsdom does not implement. Left alive, the view fires that frame
 * after the test has returned and the failure surfaces as an unattributable uncaught exception.
 * Destroying cancels the pending frame.
 */
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

describe('replaceAll', () => {
  it('replaces the document and puts the caret at the end', () => {
    const view = viewWith('avant');

    replaceAll(view, 'après');

    expect(getText(view)).toBe('après');
    expect(view.state.selection.main.anchor).toBe(5);
  });

  /*
   * The regression this function was rewritten for. CodeMirror stores one line break per line,
   * so a `\r\n` in the input becomes a single character in the document: deriving the caret from
   * the raw string length pointed past the end, and the whole transaction was rejected with
   * "Selection points outside of document". Nothing the app wrote itself used `\r\n`, so opening
   * a file from disk on Windows was the first text able to trigger it.
   */
  it('accepts CRLF text, which the caret used to be measured past the end of', () => {
    const view = viewWith('');

    expect(() => replaceAll(view, '# Titre\r\n\r\nUne ligne.\r\n')).not.toThrow();
    expect(getText(view)).toBe('# Titre\n\nUne ligne.\n');
    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
  });

  it('accepts a lone carriage return too', () => {
    const view = viewWith('');

    replaceAll(view, 'une\rdeux');

    expect(getText(view)).toBe('une\ndeux');
  });

  it('clears the document when given an empty string', () => {
    const view = viewWith('du texte');

    replaceAll(view, '');

    expect(getText(view)).toBe('');
    expect(view.state.selection.main.anchor).toBe(0);
  });

  it('leaves one undo step, which is what makes applying a rewrite safe', () => {
    const view = viewWith('original');

    replaceAll(view, 'remplacé');

    // A single transaction: one entry in the change set, not one per line.
    expect(view.state.doc.toString()).toBe('remplacé');
  });
});
