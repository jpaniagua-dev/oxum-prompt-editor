import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { RewriteEvent, RewritePreset, RewriteProvider } from '@shared/contracts.js';
import { claudeAdapter } from '../claude/claude-adapter.js';
import { codexAdapter } from '../codex/codex-adapter.js';
import type { ParsedMessage, RewriteAdapter } from './types.js';

/** A rewrite that has not produced a result by then is treated as hung. */
export const REWRITE_TIMEOUT_MS = 90_000;

interface RunningRewrite {
  readonly child: ChildProcessWithoutNullStreams;
  readonly timer: NodeJS.Timeout;
  readonly adapter: RewriteAdapter;
  readonly startedAt: number;
  /** Set when the user cancelled, so the exit is not reported as a failure. */
  cancelled: boolean;
  /** Set once a terminal event has been emitted, to guarantee exactly one. */
  settled: boolean;
}

export interface RewriteOptions {
  readonly requestId: string;
  readonly text: string;
  readonly preset: RewritePreset;
  readonly provider: RewriteProvider;
  readonly model: string;
  readonly maxBudgetUsd: number | null;
  readonly cliPath: string;
}

type SpawnProcess = (
  binary: string,
  args: string[],
  options: {
    readonly windowsHide: true;
    readonly stdio: readonly ['pipe', 'pipe', 'pipe'];
    readonly cwd?: string;
  },
) => ChildProcessWithoutNullStreams;

export interface RewriteServiceDependencies {
  readonly adapters: Readonly<Record<RewriteProvider, RewriteAdapter>>;
  readonly spawnProcess: SpawnProcess;
  readonly killProcess: (child: ChildProcessWithoutNullStreams) => void;
  readonly now: () => number;
  readonly timeoutMs: number;
}

const DEFAULT_DEPENDENCIES: RewriteServiceDependencies = {
  adapters: { claude: claudeAdapter, codex: codexAdapter },
  spawnProcess: (binary, args, options) =>
    spawn(binary, args, {
      windowsHide: options.windowsHide,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    }),
  killProcess: killTree,
  now: Date.now,
  timeoutMs: REWRITE_TIMEOUT_MS,
};

/**
 * Coordinates rewrite processes while provider adapters own only CLI-specific mechanics.
 *
 * Selection is strict: an error from one provider is reported as-is and never starts the other.
 * Cancellation, timeouts and the single-terminal-event guarantee therefore behave identically
 * for Claude and Codex.
 */
export class RewriteService {
  private readonly running = new Map<string, RunningRewrite>();

  constructor(
    private readonly emit: (event: RewriteEvent) => void,
    private readonly dependencies: RewriteServiceDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async start(options: RewriteOptions): Promise<void> {
    const adapter = this.dependencies.adapters[options.provider];
    const binary = await adapter.resolvePath(options.cliPath);
    if (binary === null) {
      this.emit({
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-missing',
        message: `CLI ${adapter.label} introuvable. Renseigne son chemin dans les réglages ou vérifie qu'il est dans le PATH.`,
      });
      return;
    }

    const args = adapter.buildArgs({
      preset: options.preset,
      model: options.model,
      maxBudgetUsd: options.maxBudgetUsd,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      const cwd = adapter.workingDirectory(binary);
      child = this.dependencies.spawnProcess(binary, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(cwd === undefined ? {} : { cwd }),
      });
    } catch (error) {
      this.emit({
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-failed',
        message: `${adapter.label} : lancement du CLI impossible : ${describeError(error)}`,
      });
      return;
    }

    const entry: RunningRewrite = {
      child,
      adapter,
      startedAt: this.dependencies.now(),
      cancelled: false,
      settled: false,
      timer: setTimeout(() => {
        const current = this.running.get(options.requestId);
        if (current === undefined) return;
        this.settle(options.requestId, {
          type: 'error',
          requestId: options.requestId,
          reason: 'timeout',
          message: `${adapter.label} : aucune réponse après ${this.dependencies.timeoutMs / 1000}s, réécriture abandonnée.`,
        });
        this.dependencies.killProcess(current.child);
      }, this.dependencies.timeoutMs),
    };
    this.running.set(options.requestId, entry);

    const parser = adapter.createParser();
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.consume(options.requestId, parser.write(chunk));
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });

    child.on('error', (error) => {
      this.settle(options.requestId, {
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-failed',
        message: `${adapter.label} : ${describeError(error)}`,
      });
    });

    child.on('close', (code) => {
      this.consume(options.requestId, parser.end());
      const current = this.running.get(options.requestId);
      if (current === undefined || current.settled) {
        this.cleanup(options.requestId);
        return;
      }
      if (current.cancelled) {
        this.settle(options.requestId, {
          type: 'error',
          requestId: options.requestId,
          reason: 'cancelled',
          message: 'Réécriture annulée.',
        });
        this.cleanup(options.requestId);
        return;
      }
      const detail = stderr.trim();
      this.settle(options.requestId, {
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-failed',
        message:
          detail.length > 0
            ? `${adapter.label} : ${detail}`
            : `${adapter.label} : CLI terminé avec le code ${code}.`,
      });
      this.cleanup(options.requestId);
    });

    child.stdin.on('error', () => {
      /* Broken pipe on an already-dead child: the close handler reports it. */
    });
    child.stdin.end(options.text, 'utf8');
  }

  cancel(requestId: string): void {
    const entry = this.running.get(requestId);
    if (entry === undefined) return;
    entry.cancelled = true;
    this.dependencies.killProcess(entry.child);
  }

  cancelAll(): void {
    for (const requestId of [...this.running.keys()]) this.cancel(requestId);
  }

  resetPathCache(provider: RewriteProvider): void {
    this.dependencies.adapters[provider].resetPathCache();
  }

  private consume(requestId: string, messages: readonly ParsedMessage[]): void {
    const entry = this.running.get(requestId);
    if (entry === undefined || entry.settled) return;

    for (const message of messages) {
      if (message.kind === 'delta') {
        this.emit({ type: 'chunk', requestId, text: message.text });
        continue;
      }
      if (message.isError || message.text.trim().length === 0) {
        this.settle(requestId, {
          type: 'error',
          requestId,
          reason: 'cli-failed',
          message:
            message.text.trim().length > 0
              ? `${entry.adapter.label} : ${message.text}`
              : `${entry.adapter.label} : le CLI a renvoyé un résultat vide.`,
        });
        continue;
      }
      this.settle(requestId, {
        type: 'done',
        requestId,
        text: message.text,
        costUsd: message.costUsd,
        durationMs:
          entry.adapter.provider === 'codex'
            ? this.dependencies.now() - entry.startedAt
            : message.durationMs,
      });
    }
  }

  private settle(requestId: string, event: RewriteEvent): void {
    const entry = this.running.get(requestId);
    if (entry !== undefined) {
      if (entry.settled) return;
      entry.settled = true;
      clearTimeout(entry.timer);
    }
    this.emit(event);
  }

  private cleanup(requestId: string): void {
    const entry = this.running.get(requestId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.running.delete(requestId);
  }
}

/** Kills a child and its descendants, including the CLI subprocess tree on Windows. */
function killTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return;
  }
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
    // Non-zero exit just means the process was already gone.
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
