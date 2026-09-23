/**
 * Incremental parser for the Claude CLI's `--output-format stream-json` output.
 *
 * The CLI emits newline-delimited JSON, but a chunk arriving on stdout can split a line
 * anywhere, so lines must be reassembled across `write()` calls.
 *
 * Two kinds of payload matter:
 *  - `stream_event` with a `text_delta`, used purely for live feedback in the UI;
 *  - the terminal `result` message, which carries the authoritative full text plus cost.
 *
 * Treating `result` as the source of truth (rather than concatenating deltas) means a
 * change in the partial-event shape degrades the typing animation without ever corrupting
 * the text the user actually applies.
 */

import type { ParsedMessage, RewriteOutputParser } from '../rewrite/types.js';

export class StreamJsonParser implements RewriteOutputParser {
  private buffer = '';

  /** Feeds raw stdout text and returns whatever complete messages it yielded. */
  write(chunk: string): ParsedMessage[] {
    this.buffer += chunk;
    const messages: ParsedMessage[] = [];

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const parsed = parseLine(line);
      if (parsed !== null) {
        messages.push(parsed);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }

    return messages;
  }

  /** Flushes a trailing line that arrived without its newline (process exit). */
  end(): ParsedMessage[] {
    const remainder = this.buffer;
    this.buffer = '';
    const parsed = parseLine(remainder);
    return parsed === null ? [] : [parsed];
  }
}

/** Parses one line. Returns null for blank lines, non-JSON noise and irrelevant events. */
export function parseLine(line: string): ParsedMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    // Not JSON: the CLI occasionally writes plain diagnostics. Never fatal.
    return null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const message = payload as Record<string, unknown>;

  if (message.type === 'result') {
    const text = typeof message.result === 'string' ? message.result : '';
    return {
      kind: 'result',
      text,
      costUsd: typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null,
      durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : 0,
      isError: message.is_error === true || message.subtype !== 'success',
    };
  }

  if (message.type === 'stream_event') {
    const text = extractTextDelta(message.event);
    return text === null ? null : { kind: 'delta', text };
  }

  return null;
}

/** Digs the text out of `{ type: 'content_block_delta', delta: { type: 'text_delta', text } }`. */
function extractTextDelta(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) {
    return null;
  }
  const record = event as Record<string, unknown>;
  if (record.type !== 'content_block_delta') {
    return null;
  }
  const delta = record.delta;
  if (typeof delta !== 'object' || delta === null) {
    return null;
  }
  const deltaRecord = delta as Record<string, unknown>;
  if (deltaRecord.type !== 'text_delta' || typeof deltaRecord.text !== 'string') {
    return null;
  }
  return deltaRecord.text;
}
