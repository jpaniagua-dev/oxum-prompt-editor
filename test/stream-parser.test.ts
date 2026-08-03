import { describe, expect, it } from 'vitest';
import { StreamJsonParser, parseLine } from '../src/main/claude/stream-parser.js';

/** Shape emitted by the CLI for an incremental text delta. */
function deltaLine(text: string): string {
  return `${JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  })}\n`;
}

function resultLine(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '# Titre\n\nCorps.',
    total_cost_usd: 0.0082,
    duration_ms: 6553,
    ...overrides,
  })}\n`;
}

describe('parseLine', () => {
  it('ignores blank lines and non-JSON noise', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json at all')).toBeNull();
    expect(parseLine('{ broken')).toBeNull();
  });

  it('ignores JSON that is not an object', () => {
    expect(parseLine('42')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('"a string"')).toBeNull();
  });

  it('ignores event types it does not care about', () => {
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull();
    expect(parseLine(JSON.stringify({ type: 'assistant', message: {} }))).toBeNull();
  });

  it('extracts a text delta', () => {
    expect(parseLine(deltaLine('Bonjour'))).toEqual({ kind: 'delta', text: 'Bonjour' });
  });

  it('ignores deltas that are not text', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('reads the terminal result with its cost', () => {
    expect(parseLine(resultLine())).toEqual({
      kind: 'result',
      text: '# Titre\n\nCorps.',
      costUsd: 0.0082,
      durationMs: 6553,
      isError: false,
    });
  });

  it('flags a failed result', () => {
    const parsed = parseLine(resultLine({ subtype: 'error_max_turns', is_error: true }));
    expect(parsed).toMatchObject({ kind: 'result', isError: true });
  });

  it('treats a non-success subtype as an error even when is_error is absent', () => {
    const parsed = parseLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution' }));
    expect(parsed).toMatchObject({ kind: 'result', isError: true, text: '' });
  });

  it('tolerates a missing cost', () => {
    const parsed = parseLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }));
    expect(parsed).toEqual({
      kind: 'result',
      text: 'ok',
      costUsd: null,
      durationMs: 0,
      isError: false,
    });
  });
});

describe('StreamJsonParser', () => {
  it('reassembles a message split across chunks', () => {
    const parser = new StreamJsonParser();
    const line = deltaLine('Salut');
    const cut = Math.floor(line.length / 2);

    expect(parser.write(line.slice(0, cut))).toEqual([]);
    expect(parser.write(line.slice(cut))).toEqual([{ kind: 'delta', text: 'Salut' }]);
  });

  it('handles several messages arriving in one chunk', () => {
    const parser = new StreamJsonParser();
    const messages = parser.write(`${deltaLine('a')}${deltaLine('b')}${resultLine()}`);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ kind: 'delta', text: 'a' });
    expect(messages[2]).toMatchObject({ kind: 'result', costUsd: 0.0082 });
  });

  it('flushes a trailing line that never got its newline', () => {
    const parser = new StreamJsonParser();
    parser.write(resultLine().trimEnd());

    const flushed = parser.end();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ kind: 'result', text: '# Titre\n\nCorps.' });
  });

  it('yields nothing on end when the buffer is empty', () => {
    const parser = new StreamJsonParser();
    parser.write(deltaLine('x'));
    expect(parser.end()).toEqual([]);
  });

  it('preserves newlines inside the delta payload', () => {
    const parser = new StreamJsonParser();
    // A rewritten prompt is multi-line Markdown: the embedded \n must survive intact,
    // otherwise the streamed preview would collapse the structure.
    expect(parser.write(deltaLine('## Contexte\n\n- point'))).toEqual([
      { kind: 'delta', text: '## Contexte\n\n- point' },
    ]);
  });
});
