import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  MarkdownCommands,
  type MarkdownCommandId,
} from '../src/renderer/editor/markdown-commands.js';

/**
 * Commands are exercised against a bare `EditorState`, with no DOM.
 *
 * `@codemirror/state` is DOM-free, so the real transaction logic runs headless. Only the two
 * members the commands actually touch are stubbed, which keeps the test honest: if a command
 * starts reaching into the view, these tests fail loudly instead of passing on a fake.
 */
interface Applied {
  readonly doc: string;
  readonly selection: string;
  readonly transactionCount: number;
}

function run(commandId: MarkdownCommandId, input: string): Applied {
  const { doc, ranges } = parse(input);
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges),
    // Without this facet a state silently keeps only its main range, so multi-cursor fixtures
    // would appear to fail in a command that is actually correct. The real editor enables it too.
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  let transactionCount = 0;

  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: unknown[]) {
      transactionCount += 1;
      // CodeMirror accepts either a spec object or a ready-made transaction.
      const spec = specs[0] as { changes?: unknown } | Transaction;
      state =
        typeof (spec as Transaction).state === 'object'
          ? (spec as Transaction).state
          : state.update(spec as Parameters<EditorState['update']>[0]).state;
    },
  } as unknown as EditorView;

  MarkdownCommands[commandId](view);

  return { doc: state.doc.toString(), selection: render(state), transactionCount };
}

/**
 * `|` marks a caret, `«`...`»` marks a selection. Several markers give several ranges.
 *
 * Guillemets rather than angle brackets: `>` is the Markdown quote marker and appears in the
 * fixtures, so `<`/`>` would be swallowed as selection bounds inside the documents under test.
 */
function parse(input: string): { doc: string; ranges: ReturnType<typeof EditorSelection.range>[] } {
  const ranges: ReturnType<typeof EditorSelection.range>[] = [];
  let doc = '';
  let anchor: number | null = null;

  for (const char of input) {
    if (char === '|') {
      ranges.push(EditorSelection.cursor(doc.length));
    } else if (char === '«') {
      anchor = doc.length;
    } else if (char === '»') {
      ranges.push(EditorSelection.range(anchor ?? doc.length, doc.length));
      anchor = null;
    } else {
      doc += char;
    }
  }

  return { doc, ranges: ranges.length > 0 ? ranges : [EditorSelection.cursor(0)] };
}

/** Renders the resulting selection back into the `|` / `«»` notation for readable assertions. */
function render(state: EditorState): string {
  const text = state.doc.toString();
  const marks: { at: number; mark: string }[] = [];

  for (const range of state.selection.ranges) {
    if (range.empty) {
      marks.push({ at: range.from, mark: '|' });
    } else {
      marks.push({ at: range.from, mark: '«' });
      marks.push({ at: range.to, mark: '»' });
    }
  }

  marks.sort((a, b) => b.at - a.at);
  let output = text;
  for (const { at, mark } of marks) {
    output = output.slice(0, at) + mark + output.slice(at);
  }
  return output;
}

describe('inline markers', () => {
  it('wraps a selection in bold and keeps the text selected', () => {
    expect(run('bold', 'un «mot» ici')).toMatchObject({
      doc: 'un **mot** ici',
      selection: 'un **«mot»** ici',
    });
  });

  it('unwraps already-bold text instead of nesting markers', () => {
    // Naive wrapping would produce ****mot****, which renders as literal asterisks.
    expect(run('bold', 'un **«mot»** ici')).toMatchObject({
      doc: 'un mot ici',
      selection: 'un «mot» ici',
    });
  });

  it('expands a bare caret to the surrounding word', () => {
    expect(run('bold', 'un m|ot ici')).toMatchObject({
      doc: 'un **mot** ici',
      selection: 'un **«mot»** ici',
    });
  });

  it('unwraps from a bare caret inside already-bold text', () => {
    // The caret expansion must stop at the markers, otherwise the "word" is `**mot**` and the
    // command wraps it a second time.
    expect(run('bold', 'un **m|ot** ici').doc).toBe('un mot ici');
  });

  it('inserts empty markers and parks the caret between them', () => {
    expect(run('bold', 'fin de phrase |')).toMatchObject({
      doc: 'fin de phrase ****',
      selection: 'fin de phrase **|**',
    });
  });

  it('handles italic, strikethrough and inline code with the same semantics', () => {
    expect(run('italic', '«mot»').doc).toBe('*mot*');
    expect(run('strikethrough', '«mot»').doc).toBe('~~mot~~');
    expect(run('code', '«mot»').doc).toBe('`mot`');
    expect(run('code', '`«mot»`').doc).toBe('mot');
  });

  it('does not strip a bold marker when italic is toggled on an empty pair', () => {
    // The inner text is empty, so `**` must not be read as an italic wrapper to remove.
    expect(run('italic', '**|**').doc).toBe('******');
  });

  it('applies to every range when there are multiple cursors', () => {
    const result = run('bold', 'a «un» b «deux» c');
    expect(result.doc).toBe('a **un** b **deux** c');
    expect(result.transactionCount).toBe(1);
  });

  it('wraps text containing spaces and punctuation verbatim', () => {
    expect(run('bold', '«deux mots, ici»').doc).toBe('**deux mots, ici**');
  });
});

describe('line prefixes', () => {
  it('adds a heading prefix', () => {
    expect(run('h2', 'Mon |titre').doc).toBe('## Mon titre');
  });

  it('removes the prefix when it is already there', () => {
    expect(run('h2', '## Mon |titre').doc).toBe('Mon titre');
  });

  it('replaces a heading of a different level instead of stacking', () => {
    // Stacking would yield '### ## Mon titre'.
    expect(run('h3', '## Mon |titre').doc).toBe('### Mon titre');
  });

  it('applies to every line of a multi-line selection in one transaction', () => {
    const result = run('bulletList', '«un\ndeux\ntrois»');
    expect(result.doc).toBe('- un\n- deux\n- trois');
    expect(result.transactionCount).toBe(1);
  });

  it('removes the prefix only when every selected line carries it', () => {
    expect(run('bulletList', '«- un\n- deux»').doc).toBe('un\ndeux');
    // One bare line means the action normalises the block rather than clearing it.
    expect(run('bulletList', '«- un\ndeux»').doc).toBe('- un\n- deux');
  });

  it('numbers an ordered list from one across the block', () => {
    expect(run('orderedList', '«un\ndeux\ntrois»').doc).toBe('1. un\n2. deux\n3. trois');
  });

  it('recognises an existing ordered list whatever its numbers', () => {
    expect(run('orderedList', '«3. un\n4. deux»').doc).toBe('un\ndeux');
  });

  it('swaps a bullet list for a task list rather than clearing the line', () => {
    // `- [ ] x` also starts with `- `, so a startsWith check would read the bullet prefix as
    // already applied and strip it instead of converting.
    expect(run('taskList', '- |un').doc).toBe('- [ ] un');
    expect(run('bulletList', '- [ ] |un').doc).toBe('- un');
  });

  it('toggles a quote', () => {
    expect(run('quote', 'cit|ation').doc).toBe('> citation');
    expect(run('quote', '> cit|ation').doc).toBe('citation');
  });

  it('adds the marker on an empty line', () => {
    expect(run('h1', '|').doc).toBe('# ');
  });
});

describe('code block', () => {
  it('fences the selected lines and parks the caret for a language', () => {
    expect(run('codeBlock', '«const x = 1;»')).toMatchObject({
      doc: '```\nconst x = 1;\n```',
      selection: '```|\nconst x = 1;\n```',
    });
  });

  it('unwraps an existing fence', () => {
    expect(run('codeBlock', '```ts\n«const x = 1;»\n```').doc).toBe('const x = 1;');
  });

  it('fences a multi-line selection as one block', () => {
    expect(run('codeBlock', '«a\nb»').doc).toBe('```\na\nb\n```');
  });
});

describe('link', () => {
  it('uses the selection as the label and parks the caret in the target', () => {
    expect(run('link', 'voir «la doc» ici')).toMatchObject({
      doc: 'voir [la doc]() ici',
      selection: 'voir [la doc](|) ici',
    });
  });

  it('detects a selected URL and puts it in the target instead', () => {
    expect(run('link', '«https://example.com»')).toMatchObject({
      doc: '[](https://example.com)',
      selection: '[|](https://example.com)',
    });
  });

  it('inserts an empty link skeleton with no selection', () => {
    expect(run('link', 'texte |')).toMatchObject({
      doc: 'texte []()',
      selection: 'texte [|]()',
    });
  });
});
