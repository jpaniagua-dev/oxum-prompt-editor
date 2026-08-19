import { app } from 'electron';
import { join } from 'node:path';

/**
 * Every path the app writes to, resolved from Electron's per-user data directory
 * (`%APPDATA%/oxum-prompt-editor` on Windows).
 *
 * Drafts live here rather than in the project so prompt content is never at risk of
 * being committed to a repository.
 */
export const AppPaths = {
  userData: (): string => app.getPath('userData'),
  draft: (): string => join(app.getPath('userData'), 'draft.md'),
  settings: (): string => join(app.getPath('userData'), 'settings.json'),
  windowState: (): string => join(app.getPath('userData'), 'window-state.json'),
  historyDir: (): string => join(app.getPath('userData'), 'history'),
  /**
   * Where each library goes unless its setting says otherwise.
   *
   * Only defaults: these are the stores the user may relocate, since saved Markdown is worth
   * syncing or versioning and `%APPDATA%` is not the place for that.
   */
  defaultNotesDir: (): string => join(app.getPath('userData'), 'notes'),
  defaultPromptsDir: (): string => join(app.getPath('userData'), 'prompts'),
} as const;
