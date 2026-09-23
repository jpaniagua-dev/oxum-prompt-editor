import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RewriteEvent, RewriteProvider } from '../src/shared/contracts.js';
import {
  RewriteService,
  type RewriteOptions,
  type RewriteServiceDependencies,
} from '../src/main/rewrite/rewrite-service.js';
import type {
  ParsedMessage,
  RewriteAdapter,
  RewriteOutputParser,
} from '../src/main/rewrite/types.js';

class MarkerParser implements RewriteOutputParser {
  write(chunk: string): ParsedMessage[] {
    if (chunk.includes('FAIL')) {
      return [
        { kind: 'result', text: 'authentication failed', costUsd: null, durationMs: 0, isError: true },
      ];
    }
    if (chunk.includes('DONE')) {
      return [
        { kind: 'result', text: 'rewritten', costUsd: null, durationMs: 12, isError: false },
      ];
    }
    return chunk.length > 0 ? [{ kind: 'delta', text: chunk }] : [];
  }

  end(): ParsedMessage[] {
    return [];
  }
}

function fakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: () => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 123;
  child.kill = () => true;
  return child as unknown as ChildProcessWithoutNullStreams;
}

function adapter(provider: RewriteProvider, path: string | null): RewriteAdapter {
  return {
    provider,
    label: provider === 'codex' ? 'Codex' : 'Claude',
    resolvePath: vi.fn(async () => path),
    buildArgs: vi.fn(() => [provider]),
    createParser: () => new MarkerParser(),
    workingDirectory: (binary) => (provider === 'codex' ? `${binary}\\..` : undefined),
    resetPathCache: vi.fn(),
  };
}

function options(provider: RewriteProvider, requestId = 'request-1'): RewriteOptions {
  return {
    requestId,
    text: 'draft',
    preset: {
      id: 'fix',
      label: 'Corriger',
      hint: '',
      kind: 'text',
      systemPrompt: 'Rewrite only.',
    },
    provider,
    model: '',
    maxBudgetUsd: provider === 'claude' ? 0.5 : null,
    cliPath: '',
  };
}

function dependencies(
  claude: RewriteAdapter,
  codex: RewriteAdapter,
  child: ChildProcessWithoutNullStreams,
  killProcess = vi.fn(),
  timeoutMs = 90_000,
): RewriteServiceDependencies {
  return {
    adapters: { claude, codex },
    spawnProcess: vi.fn(() => child),
    killProcess,
    now: vi.fn(() => 250),
    timeoutMs,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RewriteService', () => {
  it('selects only the requested provider and measures Codex duration locally', async () => {
    const child = fakeChild();
    const claude = adapter('claude', 'claude.exe');
    const codex = adapter('codex', 'C:\\Codex\\codex.exe');
    const deps = dependencies(claude, codex, child);
    const now = vi.mocked(deps.now);
    now.mockReturnValueOnce(100).mockReturnValue(350);
    const events: RewriteEvent[] = [];
    const service = new RewriteService((event) => events.push(event), deps);

    await service.start(options('codex'));
    (child.stdout as PassThrough).write('DONE');
    child.emit('close', 0);

    expect(codex.resolvePath).toHaveBeenCalledOnce();
    expect(claude.resolvePath).not.toHaveBeenCalled();
    expect(deps.spawnProcess).toHaveBeenCalledWith(
      'C:\\Codex\\codex.exe',
      ['codex'],
      expect.objectContaining({ cwd: 'C:\\Codex\\codex.exe\\..' }),
    );
    expect(events).toEqual([
      {
        type: 'done',
        requestId: 'request-1',
        text: 'rewritten',
        costUsd: null,
        durationMs: 250,
      },
    ]);
  });

  it('does not fall back when the selected CLI is missing', async () => {
    const child = fakeChild();
    const claude = adapter('claude', 'claude.exe');
    const codex = adapter('codex', null);
    const deps = dependencies(claude, codex, child);
    const events: RewriteEvent[] = [];

    await new RewriteService((event) => events.push(event), deps).start(options('codex'));

    expect(claude.resolvePath).not.toHaveBeenCalled();
    expect(deps.spawnProcess).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', reason: 'cli-missing', message: expect.stringContaining('Codex') }),
    ]);
  });

  it('kills the full process on cancel and reports cancellation on close', async () => {
    const child = fakeChild();
    const killProcess = vi.fn();
    const deps = dependencies(adapter('claude', 'claude.exe'), adapter('codex', 'codex.exe'), child, killProcess);
    const events: RewriteEvent[] = [];
    const service = new RewriteService((event) => events.push(event), deps);

    await service.start(options('claude'));
    service.cancel('request-1');
    child.emit('close', null);

    expect(killProcess).toHaveBeenCalledWith(child);
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', reason: 'cancelled' }),
    ]);
  });

  it('times out and emits only one terminal event even if the process later fails', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const killProcess = vi.fn();
    const deps = dependencies(
      adapter('claude', 'claude.exe'),
      adapter('codex', 'codex.exe'),
      child,
      killProcess,
      100,
    );
    const events: RewriteEvent[] = [];
    const service = new RewriteService((event) => events.push(event), deps);

    await service.start(options('claude'));
    await vi.advanceTimersByTimeAsync(100);
    child.emit('error', new Error('late error'));
    child.emit('close', 1);

    expect(killProcess).toHaveBeenCalledOnce();
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', reason: 'timeout' }),
    ]);
  });

  it('emits a parser terminal result only once', async () => {
    const child = fakeChild();
    const deps = dependencies(adapter('claude', 'claude.exe'), adapter('codex', 'codex.exe'), child);
    const events: RewriteEvent[] = [];
    const service = new RewriteService((event) => events.push(event), deps);

    await service.start(options('claude'));
    (child.stdout as PassThrough).write('DONE');
    (child.stdout as PassThrough).write('DONE');
    child.emit('close', 0);

    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(0);
  });
});
