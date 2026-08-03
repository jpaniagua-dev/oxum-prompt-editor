import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { RewriteEvent, RewritePreset } from '@shared/contracts.js';
import { buildRewriteArgs, resolveClaudePath } from './claude-cli.js';
import { StreamJsonParser, type ParsedMessage } from './stream-parser.js';

/** A rewrite that has not produced a result by then is treated as hung. */
const TIMEOUT_MS = 90_000;

interface RunningRewrite {
  readonly child: ChildProcessWithoutNullStreams;
  readonly timer: NodeJS.Timeout;
  /** Set when the user cancelled, so the exit is not reported as a failure. */
  cancelled: boolean;
  /** Set once a terminal event has been emitted, to guarantee exactly one. */
  settled: boolean;
}

export interface RewriteOptions {
  readonly requestId: string;
  readonly text: string;
  readonly preset: RewritePreset;
  readonly model: string;
  readonly maxBudgetUsd: number;
  readonly claudePath: string;
}

/**
 * Runs prompt rewrites by shelling out to the Claude CLI.
 *
 * Uses the CLI rather than the HTTP API so the user's existing OAuth session is reused:
 * no API key to store, no second credential to leak.
 */
export class RewriteService {
  private readonly running = new Map<string, RunningRewrite>();

  constructor(private readonly emit: (event: RewriteEvent) => void) {}

  /**
   * Starts a rewrite. Resolves as soon as the child process is spawned; the outcome
   * arrives through the emitter as chunk/done/error events.
   */
  async start(options: RewriteOptions): Promise<void> {
    const binary = await resolveClaudePath(options.claudePath);
    if (binary === null) {
      this.emit({
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-missing',
        message:
          "CLI Claude introuvable. Renseigne son chemin dans les réglages (claudePath) ou vérifie qu'il est dans le PATH.",
      });
      return;
    }

    const args = buildRewriteArgs({
      systemPrompt: options.preset.systemPrompt,
      model: options.model,
      maxBudgetUsd: options.maxBudgetUsd,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binary, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this.emit({
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-failed',
        message: `Lancement du CLI impossible: ${describeError(error)}`,
      });
      return;
    }

    const entry: RunningRewrite = {
      child,
      cancelled: false,
      settled: false,
      timer: setTimeout(() => {
        const current = this.running.get(options.requestId);
        if (current === undefined) {
          return;
        }
        this.settle(options.requestId, {
          type: 'error',
          requestId: options.requestId,
          reason: 'timeout',
          message: `Aucune réponse après ${TIMEOUT_MS / 1000}s, réécriture abandonnée.`,
        });
        killTree(current.child);
      }, TIMEOUT_MS),
    };
    this.running.set(options.requestId, entry);

    const parser = new StreamJsonParser();
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.consume(options.requestId, parser.write(chunk));
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Keep only the tail: a verbose failure should not balloon memory.
      stderr = `${stderr}${chunk}`.slice(-4000);
    });

    child.on('error', (error) => {
      this.settle(options.requestId, {
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-failed',
        message: describeError(error),
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
        return;
      }
      // Exited without ever emitting a `result` message: report the stderr tail, which is
      // where auth failures and bad flags actually surface.
      this.settle(options.requestId, {
        type: 'error',
        requestId: options.requestId,
        reason: 'cli-failed',
        message: stderr.trim().length > 0 ? stderr.trim() : `CLI terminé avec le code ${code}.`,
      });
    });

    // The draft goes over stdin: no command-line length limit, no quote escaping.
    child.stdin.on('error', () => {
      /* Broken pipe on an already-dead child: the close handler reports it. */
    });
    child.stdin.end(options.text, 'utf8');
  }

  /** Cancels a running rewrite, killing the whole process tree. */
  cancel(requestId: string): void {
    const entry = this.running.get(requestId);
    if (entry === undefined) {
      return;
    }
    entry.cancelled = true;
    killTree(entry.child);
  }

  /** Cancels everything, for app shutdown. */
  cancelAll(): void {
    for (const requestId of [...this.running.keys()]) {
      this.cancel(requestId);
    }
  }

  /** Turns parser output into renderer events. */
  private consume(requestId: string, messages: readonly ParsedMessage[]): void {
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
            message.text.trim().length > 0 ? message.text : 'Le CLI a renvoyé un résultat vide.',
        });
        continue;
      }
      this.settle(requestId, {
        type: 'done',
        requestId,
        text: message.text,
        costUsd: message.costUsd,
        durationMs: message.durationMs,
      });
    }
  }

  /** Emits a terminal event at most once per request, then releases its resources. */
  private settle(requestId: string, event: RewriteEvent): void {
    const entry = this.running.get(requestId);
    if (entry !== undefined) {
      if (entry.settled) {
        return;
      }
      entry.settled = true;
      clearTimeout(entry.timer);
    }
    this.emit(event);
  }

  private cleanup(requestId: string): void {
    const entry = this.running.get(requestId);
    if (entry !== undefined) {
      clearTimeout(entry.timer);
      this.running.delete(requestId);
    }
  }
}

/**
 * Kills a child and its descendants.
 *
 * `child.kill()` on Windows only signals the direct child, which would leave the CLI's own
 * subprocesses running and holding the API call open. `taskkill /T` walks the tree.
 */
function killTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
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
