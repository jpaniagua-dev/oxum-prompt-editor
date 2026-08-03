import type { EditorView } from '@codemirror/view';
import type {
  AppSettings,
  HistoryEntry,
  RewriteErrorEvent,
  RewriteEvent,
  RewritePreset,
  ThemeMode,
  ThemeState,
} from '@shared/contracts.js';
import {
  applyEditorTheme,
  createEditor,
  focusAtEnd,
  getText,
  replaceAll,
} from './editor/create-editor.js';
import { createAppKeymap } from './editor/keymap.js';
import { createElement, requireElement } from './ui/dom.js';
import { mountFormatBar } from './ui/format-bar.js';
import { SidePanel } from './ui/side-panel.js';
import { StatusBar } from './ui/status-bar.js';
import { Toast } from './ui/toast.js';

/** Local mirror key: a last-resort copy in case the main process dies before autosaving. */
const MIRROR_KEY = 'oxum.draft.mirror';

class App {
  private readonly statusBar = new StatusBar();
  private readonly toast = new Toast();
  private readonly panel = new SidePanel();

  private editor: EditorView | null = null;
  private settings: AppSettings | null = null;
  private presets: readonly RewritePreset[] = [];
  private theme: ThemeState = { mode: 'system', resolved: 'light' };

  /** Id of the rewrite in flight, used to ignore events from a cancelled one. */
  private activeRewriteId: string | null = null;
  private rewriteBuffer = '';

  async start(): Promise<void> {
    const bootstrap = await window.api.bootstrap();
    this.settings = bootstrap.settings;
    this.presets = bootstrap.presets;

    // Paint the theme before the editor exists: the main process already resolved it, so there
    // is no moment where the page shows the wrong palette.
    this.applyTheme(bootstrap.theme);

    const initialText = this.recoverText(bootstrap.draft);

    this.editor = createEditor({
      parent: requireElement<HTMLDivElement>('editor'),
      initialText,
      fontSize: bootstrap.settings.fontSize,
      dark: bootstrap.theme.resolved === 'dark',
      appKeymap: createAppKeymap({
        copyAndHide: () => void this.copy({ hide: true }),
        copyOnly: () => void this.copy({ hide: false }),
        rewriteDefault: () => void this.startRewrite(this.currentPresetId()),
        rewritePick: () => this.focusPresetSelect(),
        newPrompt: () => void this.newPrompt(),
        toggleHistory: () => void this.toggleHistory(),
        cycleTheme: () => void this.cycleTheme(),
        escape: () => this.handleEscape(),
      }),
      callbacks: {
        onChange: (text) => this.handleChange(text),
      },
    });

    this.statusBar.updateCounts(initialText);
    this.statusBar.markSaved();
    this.bindChrome();
    this.renderPresets();
    this.subscribeToRewrites();

    mountFormatBar(requireElement<HTMLDivElement>('format-bar'), () => this.editor);

    // Fires both on an explicit toggle and when the OS theme changes while in `system` mode.
    window.api.onThemeChanged((state) => this.applyTheme(state));
    window.api.onRequestFlush(() => this.flushToMain());
    window.addEventListener('beforeunload', () => this.flushToMain());

    if (bootstrap.recovered) {
      this.statusBar.setMessage('brouillon restauré');
    }
    focusAtEnd(this.editor);
  }

  /* ----------------------------------------------------------------- theme */

  /**
   * Reflects a theme resolved by the main process.
   *
   * The renderer never decides the theme itself: it would then have to duplicate the
   * "follow the OS" logic that already lives next to the window background colour, and the two
   * could disagree for a frame.
   */
  private applyTheme(state: ThemeState): void {
    this.theme = state;
    document.documentElement.dataset.theme = state.resolved;
    if (this.editor !== null) {
      applyEditorTheme(this.editor, state.resolved === 'dark');
    }
    this.renderThemeButton();
  }

  private async cycleTheme(): Promise<void> {
    const next = nextThemeMode(this.theme.mode);
    const state = await window.api.setThemeMode(next);
    this.applyTheme(state);
    this.statusBar.setMessage(`thème : ${describeThemeMode(state.mode)}`);
    this.editor?.focus();
  }

  /** Draws the icon for the current mode: sun, moon, or half-filled circle for "system". */
  private renderThemeButton(): void {
    const button = requireElement<HTMLButtonElement>('theme-button');
    const icon = document.getElementById('theme-icon');
    button.title = `Thème : ${describeThemeMode(this.theme.mode)} (Ctrl+Maj+D)`;

    if (icon === null) {
      return;
    }
    icon.replaceChildren();
    const spec = THEME_ICONS[this.theme.mode];
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', spec.path);
    if (spec.paint === 'stroke') {
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', 'currentColor');
      shape.setAttribute('stroke-width', '1.4');
      shape.setAttribute('stroke-linecap', 'round');
    } else {
      shape.setAttribute('fill', 'currentColor');
    }
    icon.append(shape);
  }

  /* ------------------------------------------------------------ persistence */

  /**
   * Picks the best available text at startup.
   *
   * The disk draft normally wins. The localStorage mirror only steps in when the disk copy
   * is empty, which means the main process died before its first autosave landed.
   */
  private recoverText(fromDisk: string): string {
    const mirror = window.localStorage.getItem(MIRROR_KEY) ?? '';
    if (fromDisk.length === 0 && mirror.trim().length > 0) {
      this.statusBar.setMessage('brouillon récupéré du miroir local');
      return mirror;
    }
    return fromDisk;
  }

  private handleChange(text: string): void {
    // Two independent copies on every keystroke: the main process (debounced, atomic) and
    // this synchronous local mirror. Losing both requires losing the whole machine.
    window.api.notifyDraftChanged(text);
    try {
      window.localStorage.setItem(MIRROR_KEY, text);
    } catch {
      /* Quota exceeded on an enormous draft: the disk autosave still covers us. */
    }
    this.statusBar.updateCounts(text);
    this.statusBar.markPending();
    // The main process debounce is 300ms; report saved slightly after it fires.
    window.setTimeout(() => this.statusBar.markSaved(), 400);
  }

  /** Hands the exact current buffer to the main process, for the quit path. */
  private flushToMain(): void {
    if (this.editor === null) {
      return;
    }
    window.api.notifyDraftChanged(getText(this.editor));
  }

  /* ----------------------------------------------------------------- actions */

  private async copy({ hide }: { hide: boolean }): Promise<void> {
    if (this.editor === null) {
      return;
    }
    const text = getText(this.editor);
    if (text.trim().length === 0) {
      this.toast.show('Rien à copier');
      return;
    }

    await window.api.writeClipboard(text);
    // Every copy is a checkpoint: the text was good enough to use, so it is worth keeping.
    await window.api.snapshotDraft(text, 'copy');
    this.toast.show(hide ? 'Copié, collez avec Ctrl+V' : 'Copié');

    if (hide) {
      window.api.hideWindow();
    }
  }

  private async newPrompt(): Promise<void> {
    if (this.editor === null) {
      return;
    }
    const text = getText(this.editor);
    if (text.trim().length > 0) {
      // Archive before clearing: this is the only destructive-looking action in the app,
      // and it is not actually destructive.
      await window.api.snapshotDraft(text, 'new');
    }
    replaceAll(this.editor, '');
    this.editor.focus();
    this.statusBar.setMessage('nouveau prompt (l’ancien est dans l’historique)');
  }

  private handleEscape(): void {
    if (this.panel.isOpen) {
      this.panel.close();
      this.editor?.focus();
      return;
    }
    window.api.hideWindow();
  }

  /* ---------------------------------------------------------------- rewrite */

  private currentPresetId(): string {
    return requireElement<HTMLSelectElement>('preset-select').value;
  }

  private focusPresetSelect(): void {
    const select = requireElement<HTMLSelectElement>('preset-select');
    select.focus();
    select.click();
  }

  private renderPresets(): void {
    const select = requireElement<HTMLSelectElement>('preset-select');
    select.replaceChildren();
    for (const preset of this.presets) {
      const option = createElement('option', { text: preset.label, title: preset.hint });
      option.value = preset.id;
      select.append(option);
    }
    const preferred = this.settings?.defaultPresetId ?? '';
    if (this.presets.some((preset) => preset.id === preferred)) {
      select.value = preferred;
    }
    select.addEventListener('change', () => {
      void window.api.updateSettings({ defaultPresetId: select.value });
    });
  }

  private async startRewrite(presetId: string): Promise<void> {
    if (this.editor === null) {
      return;
    }
    const original = getText(this.editor);
    if (original.trim().length === 0) {
      this.toast.show('Rien à réécrire');
      return;
    }
    if (this.activeRewriteId !== null) {
      this.toast.show('Une réécriture est déjà en cours');
      return;
    }

    const requestId = crypto.randomUUID();
    this.activeRewriteId = requestId;
    this.rewriteBuffer = '';

    const preset = this.presets.find((candidate) => candidate.id === presetId);
    this.panel.open('rewrite', `Réécriture · ${preset?.label ?? presetId}`, () => {
      if (this.activeRewriteId !== null) {
        void window.api.cancelRewrite(this.activeRewriteId);
      }
    });
    this.panel.setText('');
    this.panel.setStreaming(true);
    this.panel.setActions([
      { label: 'Annuler', onClick: () => void window.api.cancelRewrite(requestId) },
    ]);
    this.setRewriteButtonBusy(true);
    this.statusBar.setMessage('réécriture en cours…');

    await window.api.startRewrite({ requestId, text: original, presetId });
  }

  private subscribeToRewrites(): void {
    window.api.onRewriteEvent((event: RewriteEvent) => {
      if (event.requestId !== this.activeRewriteId) {
        return;
      }
      switch (event.type) {
        case 'chunk':
          this.rewriteBuffer += event.text;
          this.panel.appendText(event.text);
          break;
        case 'done':
          this.finishRewrite(event.text, event.costUsd, event.durationMs);
          break;
        case 'error':
          this.failRewrite(event.reason, event.message);
          break;
      }
    });
  }

  private finishRewrite(text: string, costUsd: number | null, durationMs: number): void {
    this.activeRewriteId = null;
    this.setRewriteButtonBusy(false);
    this.panel.setStreaming(false);
    // The streamed deltas were only a progress indicator: the final result is authoritative.
    this.panel.setText(text);

    const cost = costUsd === null ? '' : ` · ${costUsd.toFixed(4)} $`;
    this.statusBar.setMessage(`réécriture terminée en ${(durationMs / 1000).toFixed(1)}s${cost}`);

    this.panel.setActions([
      { label: 'Appliquer', variant: 'primary', title: 'Remplace le texte (Ctrl+Z pour revenir)', onClick: () => void this.applyRewrite(text) },
      { label: 'Copier', variant: 'accent', onClick: () => void this.copyRewrite(text) },
      { label: 'Relancer', onClick: () => void this.retryRewrite() },
    ]);
  }

  private failRewrite(reason: RewriteErrorEvent['reason'], message: string): void {
    this.activeRewriteId = null;
    this.setRewriteButtonBusy(false);
    this.panel.setStreaming(false);

    if (reason === 'cancelled') {
      this.panel.close();
      this.statusBar.setMessage('réécriture annulée');
      this.editor?.focus();
      return;
    }

    this.panel.setError(message);
    this.panel.setActions([{ label: 'Relancer', onClick: () => void this.retryRewrite() }]);
    this.statusBar.setMessage('échec de la réécriture', true);
  }

  /**
   * Swaps the rewritten text in.
   *
   * The original is archived first and the replacement is a single transaction, so both
   * `Ctrl+Z` and the history panel can bring it back. The user's own words are never one
   * click away from being gone.
   */
  private async applyRewrite(text: string): Promise<void> {
    if (this.editor === null) {
      return;
    }
    await window.api.snapshotDraft(getText(this.editor), 'rewrite');
    replaceAll(this.editor, text);
    this.panel.close();
    this.editor.focus();
    this.toast.show('Appliqué · Ctrl+Z pour revenir à ta version');
  }

  private async copyRewrite(text: string): Promise<void> {
    await window.api.writeClipboard(text);
    this.toast.show('Réécriture copiée');
  }

  private async retryRewrite(): Promise<void> {
    const presetId = this.currentPresetId();
    this.panel.close();
    await this.startRewrite(presetId);
  }

  private setRewriteButtonBusy(busy: boolean): void {
    const button = requireElement<HTMLButtonElement>('rewrite-button');
    button.disabled = busy;
    button.textContent = busy ? 'Réécriture…' : 'Rédiger le prompt';
  }

  /* ---------------------------------------------------------------- history */

  private async toggleHistory(): Promise<void> {
    if (this.panel.currentMode === 'history') {
      this.panel.close();
      this.editor?.focus();
      return;
    }

    const entries = await window.api.listHistory();
    this.panel.open('history', `Historique · ${entries.length}`);

    if (entries.length === 0) {
      this.panel.setContent(
        createElement('div', {
          className: 'history-empty',
          text: 'Aucun instantané pour le moment. Une copie, un nouveau prompt ou une réécriture en crée un.',
        }),
      );
      return;
    }

    const list = createElement('div', { className: 'history-list' });
    for (const entry of entries) {
      list.append(this.createHistoryItem(entry));
    }
    this.panel.setContent(list);
  }

  private createHistoryItem(entry: HistoryEntry): HTMLElement {
    const button = createElement('button', { className: 'history-item' });
    button.type = 'button';
    button.append(
      createElement('span', { className: 'history-item__title', text: entry.title }),
      createElement('span', {
        className: 'history-item__meta',
        text: `${formatTimestamp(entry.savedAt)} · ${describeReason(entry.reason)} · ${entry.size} car.`,
      }),
    );
    button.addEventListener('click', () => void this.restoreHistoryEntry(entry.id));
    return button;
  }

  /** Loads a snapshot into the editor, archiving whatever is currently there first. */
  private async restoreHistoryEntry(id: string): Promise<void> {
    if (this.editor === null) {
      return;
    }
    try {
      const text = await window.api.readHistory(id);
      const current = getText(this.editor);
      if (current.trim().length > 0) {
        await window.api.snapshotDraft(current, 'restore');
      }
      replaceAll(this.editor, text);
      this.panel.close();
      this.editor.focus();
      this.toast.show('Instantané restauré');
    } catch (error) {
      this.statusBar.setMessage(`lecture impossible: ${describeError(error)}`, true);
    }
  }

  /* ----------------------------------------------------------------- chrome */

  private bindChrome(): void {
    requireElement<HTMLButtonElement>('hide-button').addEventListener('click', () => {
      window.api.hideWindow();
    });

    const pin = requireElement<HTMLButtonElement>('pin-button');
    pin.setAttribute('aria-pressed', String(this.settings?.alwaysOnTop ?? true));
    pin.addEventListener('click', () => {
      const next = pin.getAttribute('aria-pressed') !== 'true';
      pin.setAttribute('aria-pressed', String(next));
      void window.api.setAlwaysOnTop(next);
      this.statusBar.setMessage(next ? 'toujours au premier plan' : 'premier plan désactivé');
    });

    requireElement<HTMLButtonElement>('copy-button').addEventListener('click', () => {
      void this.copy({ hide: true });
    });
    requireElement<HTMLButtonElement>('new-button').addEventListener('click', () => {
      void this.newPrompt();
    });
    requireElement<HTMLButtonElement>('history-button').addEventListener('click', () => {
      void this.toggleHistory();
    });
    requireElement<HTMLButtonElement>('rewrite-button').addEventListener('click', () => {
      void this.startRewrite(this.currentPresetId());
    });
    requireElement<HTMLButtonElement>('theme-button').addEventListener('click', () => {
      void this.cycleTheme();
    });
  }
}

/**
 * Sun for light, moon for dark, half-filled disc for "follow the system".
 *
 * The sun is drawn as strokes (its rays are lines, which a fill cannot express) while the moon
 * and the disc are solid shapes, so each icon declares how it wants to be painted.
 */
const THEME_ICONS: Record<ThemeMode, { path: string; paint: 'fill' | 'stroke' }> = {
  light: {
    path: 'M8 10.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM8 3.3V1.6M8 14.4v-1.7M3.5 8H1.8M14.2 8h-1.7M4.8 4.8 3.6 3.6M12.4 12.4l-1.2-1.2M11.2 4.8l1.2-1.2M4.8 11.2l-1.2 1.2',
    paint: 'stroke',
  },
  dark: { path: 'M9.4 1.9a6.2 6.2 0 1 0 4.7 8.9A5 5 0 0 1 9.4 1.9z', paint: 'fill' },
  system: {
    path: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 1.6v9.8a4.9 4.9 0 0 1 0-9.8z',
    paint: 'fill',
  },
};

/** Cycles light to dark to system, mirroring the order the main process expects. */
function nextThemeMode(mode: ThemeMode): ThemeMode {
  switch (mode) {
    case 'light':
      return 'dark';
    case 'dark':
      return 'system';
    case 'system':
      return 'light';
  }
}

function describeThemeMode(mode: ThemeMode): string {
  switch (mode) {
    case 'light':
      return 'clair';
    case 'dark':
      return 'sombre';
    case 'system':
      return 'système';
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeReason(reason: HistoryEntry['reason']): string {
  switch (reason) {
    case 'copy':
      return 'copie';
    case 'new':
      return 'avant nouveau';
    case 'rewrite':
      return 'avant réécriture';
    case 'restore':
      return 'avant restauration';
    case 'quit':
      return 'à la fermeture';
    case 'manual':
      return 'manuel';
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void new App().start();
