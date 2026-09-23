import { describe, expect, it } from 'vitest';
import { CodexJsonParser, parseCodexLine } from '../src/main/codex/stream-parser.js';

function line(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function message(text: string): string {
  return line({
    type: 'item.completed',
    item: { id: 'item-1', type: 'agent_message', text },
  });
}

describe('parseCodexLine', () => {
  it('ignores blank, non-JSON and irrelevant events', () => {
    expect(parseCodexLine('')).toBeNull();
    expect(parseCodexLine('not json')).toBeNull();
    expect(parseCodexLine(line({ type: 'turn.started' }))).toBeNull();
    expect(
      parseCodexLine(line({ type: 'item.completed', item: { type: 'reasoning', text: 'x' } })),
    ).toBeNull();
  });

  it('extracts completed agent messages and terminal events', () => {
    expect(parseCodexLine(message('Résultat'))).toEqual({
      kind: 'agent-message',
      text: 'Résultat',
    });
    expect(parseCodexLine(line({ type: 'turn.completed', usage: {} }))).toEqual({
      kind: 'completed',
    });
  });

  it('extracts turn failures and top-level errors', () => {
    expect(
      parseCodexLine(line({ type: 'turn.failed', error: { message: 'auth required' } })),
    ).toEqual({ kind: 'error', text: 'auth required' });
    expect(parseCodexLine(line({ type: 'error', message: 'network unavailable' }))).toEqual({
      kind: 'error',
      text: 'network unavailable',
    });
  });
});

describe('CodexJsonParser', () => {
  it('reassembles fragmented lines and returns the final message on success', () => {
    const parser = new CodexJsonParser();
    const event = message('Réécrit');
    const cut = Math.floor(event.length / 2);
    expect(parser.write(event.slice(0, cut))).toEqual([]);
    expect(parser.write(event.slice(cut))).toEqual([]);
    expect(parser.write(line({ type: 'turn.completed' }))).toEqual([
      {
        kind: 'result',
        text: 'Réécrit',
        costUsd: null,
        durationMs: 0,
        isError: false,
      },
    ]);
  });

  it('keeps the last agent message when several complete', () => {
    const parser = new CodexJsonParser();
    const results = parser.write(`${message('Intermédiaire')}${message('Final')}${line({ type: 'turn.completed' })}`);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'result', text: 'Final', isError: false });
  });

  it('reports an empty result when the turn has no agent message', () => {
    const parser = new CodexJsonParser();
    expect(parser.write(line({ type: 'turn.completed' }))).toEqual([
      { kind: 'result', text: '', costUsd: null, durationMs: 0, isError: false },
    ]);
  });

  it('returns failures and flushes a final line without a newline', () => {
    const parser = new CodexJsonParser();
    parser.write(line({ type: 'error', message: 'not logged in' }).trimEnd());
    expect(parser.end()).toEqual([
      {
        kind: 'result',
        text: 'not logged in',
        costUsd: null,
        durationMs: 0,
        isError: true,
      },
    ]);
  });
});
