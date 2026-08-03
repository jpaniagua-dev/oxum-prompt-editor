import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * Markdown styling for a *source* editor.
 *
 * The goal is legibility of structure, not a preview: headings gain weight and size while
 * their `#` markers stay visible but dimmed. Nothing is hidden or replaced, so what the
 * user sees is byte-for-byte what gets copied. That is the whole reason this app edits
 * Markdown source instead of using a WYSIWYG surface with a serialiser.
 */
export const markdownHighlighting: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700', color: '#e8ecf5' },
    { tag: tags.heading2, fontSize: '1.28em', fontWeight: '700', color: '#dfe5f0' },
    { tag: tags.heading3, fontSize: '1.12em', fontWeight: '600', color: '#d6dceb' },
    { tag: tags.heading4, fontWeight: '600', color: '#d6dceb' },
    { tag: tags.heading5, fontWeight: '600', color: '#cdd4e4' },
    { tag: tags.heading6, fontWeight: '600', color: '#cdd4e4' },

    // Structural punctuation: present, but visually recessed so the prose leads.
    { tag: tags.processingInstruction, color: '#5f6a80' },
    { tag: tags.meta, color: '#5f6a80' },

    { tag: tags.strong, fontWeight: '700', color: '#f0d9a8' },
    { tag: tags.emphasis, fontStyle: 'italic', color: '#c9b6e8' },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: '#7f8798' },

    { tag: tags.link, color: '#6fa8f5', textDecoration: 'underline' },
    { tag: tags.url, color: '#5b8def' },

    { tag: tags.monospace, color: '#7fd6b5' },
    { tag: tags.quote, color: '#9aa3b4', fontStyle: 'italic' },
    { tag: tags.list, color: '#8fa0bd' },

    // Code inside fenced blocks, highlighted by the per-language parsers.
    { tag: tags.keyword, color: '#c792ea' },
    { tag: tags.controlKeyword, color: '#c792ea' },
    { tag: tags.definitionKeyword, color: '#c792ea' },
    { tag: tags.string, color: '#a5d6a7' },
    { tag: tags.number, color: '#f7a86a' },
    { tag: tags.bool, color: '#f7a86a' },
    { tag: tags.comment, color: '#6b7486', fontStyle: 'italic' },
    { tag: tags.typeName, color: '#8ad3f0' },
    { tag: tags.className, color: '#8ad3f0' },
    { tag: tags.propertyName, color: '#9fc6f5' },
    { tag: tags.variableName, color: '#e6e9f0' },
    { tag: tags.function(tags.variableName), color: '#82c8f8' },
    { tag: tags.operator, color: '#89ddff' },
    { tag: tags.punctuation, color: '#a7b0c0' },
  ]),
);

/** Inline code and fenced blocks get a faint backdrop so they read as verbatim regions. */
export const editorTheme: Extension = EditorView.theme(
  {
    '&': { color: 'var(--text)', backgroundColor: 'var(--bg)' },
    '.cm-line': { padding: '0 2px' },
    '.cm-activeLine': { backgroundColor: '#ffffff06' },
    '.cm-matchingBracket': { backgroundColor: '#3a4a6b80', outline: 'none' },
  },
  { dark: true },
);
