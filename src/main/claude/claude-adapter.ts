import type { RewriteAdapter } from '../rewrite/types.js';
import { buildClaudeArgs, resetClaudePathCache, resolveClaudePath } from './claude-cli.js';
import { StreamJsonParser } from './stream-parser.js';

export const claudeAdapter: RewriteAdapter = {
  provider: 'claude',
  label: 'Claude',
  resolvePath: resolveClaudePath,
  buildArgs: ({ preset, model, maxBudgetUsd }) =>
    buildClaudeArgs({
      systemPrompt: preset.systemPrompt,
      model,
      maxBudgetUsd: maxBudgetUsd ?? 0.5,
    }),
  createParser: () => new StreamJsonParser(),
  workingDirectory: () => undefined,
  resetPathCache: resetClaudePathCache,
};
