import type { SyntaxNode } from '@lezer/common';
import { Emoji, GFM, Subscript, Superscript, parser } from '@lezer/markdown';

/**
 * The same dialect the editor highlights.
 *
 * `@codemirror/lang-markdown` builds its `markdownLanguage` from exactly this list, so a
 * construct the editor colours as a table is a table here too. Configuring the parser twice is
 * the price of not importing the editor into the preview: reading `markdownLanguage.parser`
 * instead would tie a pure function to a CodeMirror `Language` and make it untestable outside
 * the browser.
 */
const previewParser = parser.configure([GFM, Subscript, Superscript, Emoji]);

export interface MarkdownRenderOptions {
  /**
   * Called when a link is activated, with a URL that already passed the scheme check.
   *
   * Links are never navigable on their own: this document is rendered inside the app window, and
   * an `<a href>` followed in place would replace the editor with a web page and lose the draft.
   */
  readonly onLinkActivate?: (url: string) => void;
}

/** Schemes a link may carry. Everything else renders as inert text, `javascript:` included. */
const SAFE_SCHEMES = /^(?:https?:|mailto:)/i;

/** Nodes that exist only to mark up the source and have nothing to show. */
const SYNTAX_MARKS = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'LinkMark',
  'EmphasisMark',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'CodeMark',
  'CodeInfo',
  'TaskMarker',
  'TableDelimiter',
  'LinkTitle',
  'LinkLabel',
  'URL',
]);

interface Context {
  readonly source: string;
  readonly options: MarkdownRenderOptions;
}

/**
 * Renders Markdown to DOM nodes.
 *
 * Every element is built explicitly rather than by assigning a string to `innerHTML`. That is
 * not caution for its own sake: the input is a draft the user may have pasted from anywhere, and
 * the one thing a preview must never do is execute it. With no HTML ever parsed, embedded markup
 * is text and nothing more, which is also why a `<script>` in the draft shows up as `<script>`.
 */
export function renderMarkdown(
  source: string,
  options: MarkdownRenderOptions = {},
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendBlocks(fragment, previewParser.parse(source).topNode, { source, options });
  return fragment;
}

/* ------------------------------------------------------------------ blocks */

function appendBlocks(parent: ParentNode, node: SyntaxNode, context: Context): void {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    const rendered = renderBlock(child, context);
    if (rendered !== null) {
      parent.append(rendered);
    }
  }
}

function renderBlock(node: SyntaxNode, context: Context): Node | null {
  const name = node.name;

  if (name.startsWith('ATXHeading') || name.startsWith('SetextHeading')) {
    return renderHeading(node, context);
  }

  switch (name) {
    case 'Paragraph':
      return inlineElement('p', node, context);

    case 'Blockquote': {
      const quote = document.createElement('blockquote');
      appendBlocks(quote, node, context);
      return quote;
    }

    case 'BulletList':
      return renderList('ul', node, context);

    case 'OrderedList':
      return renderList('ol', node, context);

    case 'ListItem': {
      const item = document.createElement('li');
      appendBlocks(item, node, context);
      return item;
    }

    // A GFM task item: the checkbox replaces the `[x]` marker and the rest of the line is
    // ordinary inline content. Disabled, because this is a view of the text, not a form.
    case 'Task': {
      const line = document.createElement('p');
      line.className = 'preview__task';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = true;
      box.checked = /^\[[xX]\]/.test(context.source.slice(node.from, node.to));

      // Built aside so the space that followed the marker can be trimmed: with the checkbox
      // already in place it would no longer be the element's first node, and would survive as a
      // visible indent in front of every task.
      const content = document.createElement('span');
      appendInline(content, node, context);
      trimEdges(content);

      line.append(box, ...content.childNodes);
      return line;
    }

    case 'FencedCode':
    case 'CodeBlock':
      return renderCode(node, context);

    case 'HorizontalRule':
      return document.createElement('hr');

    case 'Table':
      return renderTable(node, context);

    // Raw HTML is shown as the text it is. See the note on `renderMarkdown`.
    case 'HTMLBlock': {
      const block = document.createElement('pre');
      block.className = 'preview__raw';
      block.textContent = context.source.slice(node.from, node.to);
      return block;
    }

    // A comment is invisible in every renderer, and a link definition is machinery rather than
    // content. Both would be noise at the top of a preview.
    case 'CommentBlock':
    case 'ProcessingInstructionBlock':
    case 'LinkReference':
      return null;

    default:
      return SYNTAX_MARKS.has(name) ? null : inlineElement('p', node, context);
  }
}

function renderHeading(node: SyntaxNode, context: Context): HTMLElement {
  const level = Math.min(Number(node.name.slice(-1)), 6);
  const heading = document.createElement(`h${String(level)}`);
  appendInline(heading, node, context);
  // The `#` markers are gone but the space that followed them is not, and neither is a closing
  // `###`. Both are source syntax, so they are trimmed off the rendered text.
  trimEdges(heading);
  return heading;
}

function renderList(tag: 'ul' | 'ol', node: SyntaxNode, context: Context): HTMLElement {
  const list = document.createElement(tag);
  if (tag === 'ol') {
    const start = firstOrderedNumber(node, context.source);
    // Only when it differs from the default: `start="1"` on every list is noise in the DOM.
    if (start !== null && start !== 1) {
      (list as HTMLOListElement).start = start;
    }
  }
  appendBlocks(list, node, context);
  return list;
}

/** The number a `3.` list starts at, so a numbered list keeps the author's numbering. */
function firstOrderedNumber(node: SyntaxNode, source: string): number | null {
  const mark = node.firstChild?.getChild('ListMark') ?? null;
  if (mark === null) {
    return null;
  }
  const parsed = Number.parseInt(source.slice(mark.from, mark.to), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A code block, fenced or indented.
 *
 * The parser emits one `CodeText` per line rather than one span for the whole block, and the
 * gaps between them are exactly what must not be shown: the four-space indent of an indented
 * block, the `>` of a blockquote, the padding of a list item. Joining the children therefore
 * both assembles the text and strips the decoration, where reading the node's own range would
 * keep every one of them. No children at all means an empty fence, for which an empty string is
 * the right answer.
 */
function renderCode(node: SyntaxNode, context: Context): HTMLElement {
  const raw = node
    .getChildren('CodeText')
    .map((line) => context.source.slice(line.from, line.to))
    .join('');

  const code = document.createElement('code');
  code.textContent = raw.replace(/\n$/, '');

  const info = node.getChild('CodeInfo');
  if (info !== null) {
    const language = context.source.slice(info.from, info.to).trim();
    if (language.length > 0) {
      code.dataset.language = language;
    }
  }

  const block = document.createElement('pre');
  block.className = 'preview__code';
  block.append(code);
  return block;
}

/**
 * A GFM table.
 *
 * `TableHeader` and `TableRow` both hold `TableCell` children and only the tag around them
 * differs, so the row builder is shared. The alignment row is a `TableDelimiter`, i.e. a mark,
 * and is skipped with the others.
 */
function renderTable(node: SyntaxNode, context: Context): HTMLElement {
  const table = document.createElement('table');
  table.className = 'preview__table';
  const head = document.createElement('thead');
  const body = document.createElement('tbody');

  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === 'TableHeader') {
      head.append(renderRow(child, 'th', context));
    } else if (child.name === 'TableRow') {
      body.append(renderRow(child, 'td', context));
    }
  }

  if (head.childElementCount > 0) {
    table.append(head);
  }
  if (body.childElementCount > 0) {
    table.append(body);
  }
  return table;
}

function renderRow(node: SyntaxNode, tag: 'th' | 'td', context: Context): HTMLTableRowElement {
  const row = document.createElement('tr');
  for (let cell = node.firstChild; cell !== null; cell = cell.nextSibling) {
    if (cell.name === 'TableCell') {
      row.append(inlineElement(tag, cell, context));
    }
  }
  return row;
}

/* ------------------------------------------------------------------ inline */

function inlineElement(tag: string, node: SyntaxNode, context: Context): HTMLElement {
  const element = document.createElement(tag);
  appendInline(element, node, context);
  return element;
}

/**
 * Appends a node's inline content, restricted to the `from`..`to` range.
 *
 * Everything the parser did not claim as a child is literal text, which is what makes the walk
 * total: an unrecognised construct degrades to the characters the user typed rather than
 * disappearing. Marks return null from {@link renderInline} and their source range is skipped
 * along with them, which is how `**` stops being visible once `<strong>` wraps its content.
 */
function appendInline(
  parent: ParentNode,
  node: SyntaxNode,
  context: Context,
  from: number = node.from,
  to: number = node.to,
): void {
  let position = from;

  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) {
      continue;
    }
    if (child.from > position) {
      parent.append(document.createTextNode(context.source.slice(position, child.from)));
    }
    const rendered = renderInline(child, context);
    if (rendered !== null) {
      parent.append(rendered);
    }
    position = child.to;
  }

  if (position < to) {
    parent.append(document.createTextNode(context.source.slice(position, to)));
  }
}

function renderInline(node: SyntaxNode, context: Context): Node | null {
  switch (node.name) {
    case 'Emphasis':
      return inlineElement('em', node, context);
    case 'StrongEmphasis':
      return inlineElement('strong', node, context);
    case 'Strikethrough':
      return inlineElement('del', node, context);
    case 'Superscript':
      return inlineElement('sup', node, context);
    case 'Subscript':
      return inlineElement('sub', node, context);

    case 'InlineCode': {
      const code = document.createElement('code');
      code.className = 'preview__inline-code';
      code.textContent = innerText(node, context.source);
      return code;
    }

    case 'Link':
      return renderLink(node, context);

    case 'Autolink': {
      const url = stripBrackets(context.source.slice(node.from, node.to));
      return linkElement(url, url, context);
    }

    case 'Image':
      return renderImage(node, context);

    case 'HardBreak':
      return document.createElement('br');

    // An escape renders as what it protected: drop the backslash, keep the character.
    case 'Escape':
      return document.createTextNode(context.source.slice(node.from + 1, node.to));

    case 'Entity':
      return document.createTextNode(decodeEntity(context.source.slice(node.from, node.to)));

    default:
      if (SYNTAX_MARKS.has(node.name)) {
        return null;
      }
      // Inline HTML, emoji shortcodes, and whatever a future extension adds: shown as typed.
      return node.firstChild === null
        ? document.createTextNode(context.source.slice(node.from, node.to))
        : inlineElement('span', node, context);
  }
}

/**
 * An inline link, `[label](url)`.
 *
 * The label is the range between the opening `[` and the `]` that closes it, located through the
 * marks rather than through a child count: a link may hold any number of inline children, and a
 * reference link has no `URL` child at all.
 */
function renderLink(node: SyntaxNode, context: Context): Node {
  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === 'LinkMark') {
      marks.push(child);
    }
  }
  const opening = marks[0] ?? null;
  const closing = marks.find((mark) => context.source.slice(mark.from, mark.to) === ']') ?? null;
  const labelFrom = opening === null ? node.from : opening.to;
  const labelTo = closing === null ? node.to : closing.from;

  const target = node.getChild('URL');
  const url = target === null ? '' : stripBrackets(context.source.slice(target.from, target.to));

  const element = linkElement(url, null, context);
  appendInline(element, node, context, labelFrom, labelTo);
  return element;
}

/**
 * Builds the clickable — or deliberately unclickable — link element.
 *
 * A URL whose scheme is not in {@link SAFE_SCHEMES} becomes a plain span: `javascript:` above
 * all, but also `file:` and a bare relative path, which mean nothing outside the machine the
 * document was written on. It still reads as a link, it simply does not act as one.
 */
function linkElement(url: string, label: string | null, context: Context): HTMLElement {
  if (!SAFE_SCHEMES.test(url)) {
    const inert = document.createElement('span');
    inert.className = 'preview__link preview__link--inert';
    inert.title = url.length > 0 ? url : 'Lien sans cible';
    if (label !== null) {
      inert.textContent = label;
    }
    return inert;
  }

  // No `href`: the click is handled here and handed to the system browser. An href would let a
  // middle click or a drag navigate the app window itself, which has no way back.
  const anchor = document.createElement('a');
  anchor.className = 'preview__link';
  anchor.setAttribute('role', 'link');
  anchor.tabIndex = 0;
  anchor.title = url;
  if (label !== null) {
    anchor.textContent = label;
  }

  const activate = (): void => context.options.onLinkActivate?.(url);
  anchor.addEventListener('click', activate);
  anchor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
  return anchor;
}

/**
 * An image, rendered as a labelled placeholder rather than an `<img>`.
 *
 * The renderer's Content-Security-Policy allows images from the bundle and from `data:` only, so
 * a real `<img>` pointing at a remote or on-disk file would silently show a broken icon. A chip
 * carrying the alt text and the URL says what is there, which is what a prompt author needs.
 */
function renderImage(node: SyntaxNode, context: Context): HTMLElement {
  const target = node.getChild('URL');
  const url = target === null ? '' : context.source.slice(target.from, target.to).trim();
  const alt = /^!\[([^\]]*)\]/.exec(context.source.slice(node.from, node.to))?.[1] ?? '';

  const chip = document.createElement('span');
  chip.className = 'preview__image';
  chip.textContent = alt.length > 0 ? alt : url;
  chip.title = url;
  return chip;
}

/* ----------------------------------------------------------------- helpers */

/** The content of a delimited inline node: everything between its first and last mark. */
function innerText(node: SyntaxNode, source: string): string {
  const first = node.firstChild;
  const last = node.lastChild;
  if (first === null || last === null || first === last) {
    return source.slice(node.from, node.to);
  }
  return source.slice(first.to, last.from);
}

/** Removes the angle brackets an autolink or a `<url>` destination is written with. */
function stripBrackets(url: string): string {
  return url.trim().replace(/^<|>$/g, '');
}

/** The handful of named entities worth decoding, alongside the numeric forms. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Decodes one entity, without going through the DOM.
 *
 * The usual trick — assigning to `innerHTML` and reading `textContent` back — is exactly the
 * HTML parse this module exists to avoid. An entity that is not covered is left as written,
 * which is what the source said anyway.
 */
function decodeEntity(raw: string): string {
  const named = NAMED_ENTITIES[raw.toLowerCase()];
  if (named !== undefined) {
    return named;
  }
  const numeric = /^&#(x)?([0-9a-f]+);$/i.exec(raw);
  if (numeric === null) {
    return raw;
  }
  const code = Number.parseInt(numeric[2] ?? '', numeric[1] === undefined ? 10 : 16);
  return Number.isNaN(code) || code > 0x10ffff ? raw : String.fromCodePoint(code);
}

/** Strips the whitespace the syntax left at both ends of an element's text. */
function trimEdges(element: HTMLElement): void {
  const first = element.firstChild;
  if (first !== null && first.nodeType === Node.TEXT_NODE) {
    first.textContent = (first.textContent ?? '').replace(/^\s+/, '');
  }
  const last = element.lastChild;
  if (last !== null && last.nodeType === Node.TEXT_NODE) {
    last.textContent = (last.textContent ?? '').replace(/\s+$/, '');
  }
}
