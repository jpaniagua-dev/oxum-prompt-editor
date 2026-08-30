// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../src/renderer/preview/render-markdown.js';

/** Renders into a detached container, which is what the preview pane does. */
function render(source: string): HTMLElement {
  const host = document.createElement('div');
  host.append(renderMarkdown(source));
  return host;
}

describe('renderMarkdown', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('turns ATX headings into real heading elements, without their markers', () => {
    const host = render('# Titre\n\n## Sous-titre ##');

    expect(host.querySelector('h1')?.textContent).toBe('Titre');
    expect(host.querySelector('h2')?.textContent).toBe('Sous-titre');
  });

  it('caps the heading level at six', () => {
    expect(render('###### Six').querySelector('h6')).not.toBeNull();
  });

  it('renders setext headings too', () => {
    expect(render('Titre\n=====').querySelector('h1')?.textContent).toBe('Titre');
  });

  it('renders inline emphasis without leaving the delimiters visible', () => {
    const host = render('Du **gras**, de l’*italique* et du ~~barré~~.');

    expect(host.querySelector('strong')?.textContent).toBe('gras');
    expect(host.querySelector('em')?.textContent).toBe('italique');
    expect(host.querySelector('del')?.textContent).toBe('barré');
    expect(host.textContent).toBe('Du gras, de l’italique et du barré.');
  });

  it('renders bullet and ordered lists, keeping the author’s starting number', () => {
    const host = render('- un\n- deux\n\n3. trois\n4. quatre');

    expect([...host.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['un', 'deux']);
    expect(host.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('renders a task list as disabled checkboxes reflecting their state', () => {
    const host = render('- [x] fait\n- [ ] à faire');
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    // Per item, not on the whole tree: what matters is that no marker leftover survives in
    // front of the label, and concatenating two `<li>` would hide exactly that.
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'fait',
      'à faire',
    ]);
  });

  it('renders a fenced code block, keeping its text verbatim and noting the language', () => {
    const host = render('```ts\nconst a = **1**;\n```');
    const code = host.querySelector('pre > code');

    expect(code?.textContent).toBe('const a = **1**;');
    expect(code?.getAttribute('data-language')).toBe('ts');
    // Nothing inside a fence is Markdown: the stars must survive as characters.
    expect(host.querySelector('strong')).toBeNull();
  });

  it('strips the four-space indent of an indented code block', () => {
    expect(render('    ligne un\n    ligne deux').querySelector('code')?.textContent).toBe(
      'ligne un\nligne deux',
    );
  });

  it('renders a GFM table with a header row', () => {
    const host = render('| a | b |\n| --- | --- |\n| 1 | 2 |');

    expect([...host.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['a', 'b']);
    expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['1', '2']);
    // The alignment row is syntax, so it must not become a body row of dashes.
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders blockquotes and horizontal rules', () => {
    const host = render('> cité\n\n---');

    expect(host.querySelector('blockquote')?.textContent).toBe('cité');
    expect(host.querySelector('hr')).not.toBeNull();
  });

  describe('links', () => {
    it('calls back instead of navigating, and never carries an href', () => {
      const onLinkActivate = vi.fn();
      const host = document.createElement('div');
      host.append(renderMarkdown('[Anthropic](https://anthropic.com)', { onLinkActivate }));

      const anchor = host.querySelector('a');
      expect(anchor?.textContent).toBe('Anthropic');
      expect(anchor?.hasAttribute('href')).toBe(false);

      anchor?.dispatchEvent(new MouseEvent('click'));
      expect(onLinkActivate).toHaveBeenCalledWith('https://anthropic.com');
    });

    it('renders a javascript: link as inert text', () => {
      const onLinkActivate = vi.fn();
      const host = document.createElement('div');
      host.append(renderMarkdown('[clique](javascript:alert(1))', { onLinkActivate }));

      expect(host.querySelector('a')).toBeNull();
      expect(host.querySelector('.preview__link--inert')?.textContent).toBe('clique');

      host.querySelector('span')?.dispatchEvent(new MouseEvent('click'));
      expect(onLinkActivate).not.toHaveBeenCalled();
    });

    it('renders a relative link as inert too, since it means nothing outside its machine', () => {
      expect(render('[voir](./notes.md)').querySelector('a')).toBeNull();
    });

    it('renders an autolink with the URL as its own label', () => {
      expect(render('<https://example.com>').querySelector('a')?.textContent).toBe(
        'https://example.com',
      );
    });
  });

  describe('untrusted input', () => {
    it('never parses embedded HTML, in a block or inline', () => {
      const host = render('<script>alert(1)</script>\n\nUn <b>gras</b> HTML.');

      expect(host.querySelector('script')).toBeNull();
      expect(host.querySelector('b')).toBeNull();
      expect(host.textContent).toContain('<script>alert(1)</script>');
      expect(host.textContent).toContain('<b>gras</b>');
    });

    it('renders an image as a placeholder rather than loading anything', () => {
      const host = render('![Un schéma](https://example.com/x.png)');

      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('.preview__image')?.textContent).toBe('Un schéma');
    });
  });

  it('decodes escapes and the common entities', () => {
    expect(render('\\*pas de gras\\* &amp; &#65;').textContent).toBe('*pas de gras* & A');
  });

  it('renders an empty document as nothing at all', () => {
    expect(render('').childNodes).toHaveLength(0);
  });

  it('keeps the text of a construct it does not know how to style', () => {
    // A reference definition is hidden, but the paragraph around it must survive intact.
    expect(render('[ref]: https://example.com\n\nDu texte.').textContent).toBe('Du texte.');
  });
});
