import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedPath: string | null = null;

export interface CodexPathDependencies {
  readonly exists: (path: string) => boolean;
  readonly findOnPath: () => Promise<string | null>;
  readonly appBinDirectory: string;
  readonly findInApp: (directory: string) => string | null;
}

const defaultDependencies: CodexPathDependencies = {
  exists: existsSync,
  findOnPath: () => findOnPath('codex'),
  appBinDirectory: join(
    process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
    'OpenAI',
    'Codex',
    'bin',
  ),
  findInApp: findBundledCodexPath,
};

/** Resolves a configured CLI first, then PATH, then the local Codex desktop installation. */
export async function resolveCodexPath(
  configuredPath: string,
  dependencies: CodexPathDependencies = defaultDependencies,
): Promise<string | null> {
  if (configuredPath.length > 0) {
    return dependencies.exists(configuredPath) ? configuredPath : null;
  }
  if (dependencies === defaultDependencies && cachedPath !== null) {
    return cachedPath;
  }

  const fromPath = await dependencies.findOnPath();
  if (fromPath !== null && dependencies.exists(fromPath)) {
    if (dependencies === defaultDependencies) cachedPath = fromPath;
    return fromPath;
  }

  const fromApp = dependencies.findInApp(dependencies.appBinDirectory);
  if (fromApp !== null && dependencies.exists(fromApp)) {
    if (dependencies === defaultDependencies) cachedPath = fromApp;
    return fromApp;
  }
  return null;
}

export function resetCodexPathCache(): void {
  cachedPath = null;
}

/** Finds the newest versioned `bin/<hash>/codex.exe` shipped by the desktop app. */
export function findBundledCodexPath(binDirectory: string): string | null {
  try {
    return readdirSync(binDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(binDirectory, entry.name, 'codex.exe'))
      .filter(existsSync)
      .map((path) => ({ path, modifiedAt: statSync(path).mtimeMs }))
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path ?? null;
  } catch {
    return null;
  }
}

async function findOnPath(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where', [command], { windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null;
  } catch {
    return null;
  }
}

/** Exact non-interactive invocation. The draft remains on stdin, never in this array. */
export function buildCodexArgs(options: { systemPrompt: string; model: string }): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--json',
  ];
  if (options.model.trim().length > 0) {
    args.push('--model', options.model.trim());
  }
  args.push(options.systemPrompt);
  return args;
}
