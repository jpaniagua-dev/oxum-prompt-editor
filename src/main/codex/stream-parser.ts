import type { ParsedMessage, RewriteOutputParser } from '../rewrite/types.js';

type CodexEvent =
  | { readonly kind: 'agent-message'; readonly text: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'error'; readonly text: string };

/** Incremental JSONL parser retaining the last completed agent message as the final answer. */
export class CodexJsonParser implements RewriteOutputParser {
  private buffer = '';
  private lastAgentMessage = '';

  write(chunk: string): ParsedMessage[] {
    this.buffer += chunk;
    const messages: ParsedMessage[] = [];
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      this.consumeLine(this.buffer.slice(0, newlineIndex), messages);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
    }
    return messages;
  }

  end(): ParsedMessage[] {
    const messages: ParsedMessage[] = [];
    const remainder = this.buffer;
    this.buffer = '';
    this.consumeLine(remainder, messages);
    return messages;
  }

  private consumeLine(line: string, messages: ParsedMessage[]): void {
    const event = parseCodexLine(line);
    if (event === null) return;
    if (event.kind === 'agent-message') {
      this.lastAgentMessage = event.text;
      return;
    }
    if (event.kind === 'completed') {
      messages.push({
        kind: 'result',
        text: this.lastAgentMessage,
        costUsd: null,
        durationMs: 0,
        isError: false,
      });
      return;
    }
    messages.push({
      kind: 'result',
      text: event.text,
      costUsd: null,
      durationMs: 0,
      isError: true,
    });
  }
}

/** Parses the Codex events relevant to a text-only rewrite. Noise and malformed JSON are ignored. */
export function parseCodexLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as Record<string, unknown>;

  if (event.type === 'item.completed') {
    const item = asRecord(event.item);
    return item.type === 'agent_message' && typeof item.text === 'string'
      ? { kind: 'agent-message', text: item.text }
      : null;
  }
  if (event.type === 'turn.completed') return { kind: 'completed' };
  if (event.type === 'turn.failed') {
    return { kind: 'error', text: errorText(event.error, 'La réécriture Codex a échoué.') };
  }
  if (event.type === 'error') {
    return { kind: 'error', text: errorText(event, 'Erreur du CLI Codex.') };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function errorText(value: unknown, fallback: string): string {
  const record = asRecord(value);
  if (typeof record.message === 'string' && record.message.trim().length > 0) {
    return record.message.trim();
  }
  const nested = asRecord(record.error);
  return typeof nested.message === 'string' && nested.message.trim().length > 0
    ? nested.message.trim()
    : fallback;
}
