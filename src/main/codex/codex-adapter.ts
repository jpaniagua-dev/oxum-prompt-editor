import { dirname } from 'node:path';
import type { RewriteAdapter } from '../rewrite/types.js';
import { buildCodexArgs, resetCodexPathCache, resolveCodexPath } from './codex-cli.js';
import { CodexJsonParser } from './stream-parser.js';

export const codexAdapter: RewriteAdapter = {
  provider: 'codex',
  label: 'Codex',
  resolvePath: resolveCodexPath,
  buildArgs: ({ preset, model }) =>
    buildCodexArgs({ systemPrompt: preset.systemPrompt, model }),
  createParser: () => new CodexJsonParser(),
  // No project directory, AGENTS.md or repository state can leak into a pure text rewrite.
  workingDirectory: (binary) => dirname(binary),
  resetPathCache: resetCodexPathCache,
};
