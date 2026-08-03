import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Cached result so the lookup runs once per session, not once per rewrite. */
let cachedPath: string | null = null;

/**
 * Locates the Claude CLI.
 *
 * Order: the explicit setting, then `where` on the PATH, then the default install
 * location. A GUI app launched from the Start menu does not always inherit the shell PATH
 * that `where` relies on, which is why the hardcoded fallback matters.
 *
 * @param configuredPath Value of the `claudePath` setting; empty means auto-detect.
 * @returns Absolute path to the executable, or null when it cannot be found.
 */
export async function resolveClaudePath(configuredPath: string): Promise<string | null> {
  if (configuredPath.length > 0) {
    return existsSync(configuredPath) ? configuredPath : null;
  }
  if (cachedPath !== null) {
    return cachedPath;
  }

  const fromPath = await whichClaude();
  if (fromPath !== null) {
    cachedPath = fromPath;
    return fromPath;
  }

  const fallback = join(homedir(), '.local', 'bin', 'claude.exe');
  if (existsSync(fallback)) {
    cachedPath = fallback;
    return fallback;
  }

  return null;
}

/** Clears the cache so a settings change takes effect without a restart. */
export function resetClaudePathCache(): void {
  cachedPath = null;
}

/** Asks Windows for the first `claude` on the PATH. */
async function whichClaude(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where', ['claude'], { windowsHide: true });
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first !== undefined && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * Builds the argument list for a one-shot, non-agentic rewrite.
 *
 * Each flag earns its place:
 *  - `--tools ""` removes every tool: this is a text transformation, so filesystem or
 *    network access would be pure risk with no upside.
 *  - `--safe-mode` ignores CLAUDE.md, hooks, MCP servers and skills, making the call fast
 *    and reproducible instead of inheriting whatever the user's config happens to be.
 *  - `--no-session-persistence` keeps these throwaway calls out of the `/resume` history.
 *  - `--max-budget-usd` is a hard ceiling against a runaway generation.
 *
 * The draft itself is never passed here: it goes over stdin, because Windows caps a command
 * line at roughly 32k characters and quoting a multi-line Markdown document through the
 * shell is a bug waiting to happen.
 */
export function buildRewriteArgs(options: {
  systemPrompt: string;
  model: string;
  maxBudgetUsd: number;
}): string[] {
  return [
    '--print',
    '--model',
    options.model,
    '--tools',
    '',
    '--safe-mode',
    '--no-session-persistence',
    '--system-prompt',
    options.systemPrompt,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--max-budget-usd',
    String(options.maxBudgetUsd),
  ];
}
