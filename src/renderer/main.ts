import type { EditorView } from '@codemirror/view';
import type {
  AppSettings,
  HistoryEntry,
  LibraryEntry,
  LibraryId,
  PresetKind,
  RewriteErrorEvent,
  RewriteEvent,
  RewritePreset,
  ThemeMode,
  ThemeState,
} from '@shared/contracts.js';
import {
  applyEditorFontSize,
  applyEditorTheme,
  createEditor,
  focusAtEnd,
  getText,
  replaceAll,
} from './editor/create-editor.js';
import { createAppKeymap } from './editor/keymap.js';
import { createElement, requireElement } from './ui/dom.js';
import { formatTimestamp } from './ui/format.js';
import { mountFormatBar } from './ui/format-bar.js';
import {
  confirmButton,
  renderLibraryEmpty,
  renderLibraryList,
} from './ui/library-panel.js';
import { SettingsPage } from './ui/settings-page.js';
import { SidePanel } from './ui/side-panel.js';
import { StatusBar } from './ui/status-bar.js';
import { Toast } from './ui/toast.js';
import { TokenBadge } from './ui/token-badge.js';

/** Local mirror key: a last-resort copy in case the main process dies before autosaving. */
const MIRROR_KEY = 'oxum.draft.mirror';

class App {
  private readonly statusBar = new StatusBar();
  private readonly tokenBadge = new TokenBadge();
  private readonly toast = new Toast();
  private readonly panel = new SidePanel();

  private readonly settingsPage = new SettingsPage({
    onSave: (settings) => void this.applySettings(settings),
    onPickDirectory: (current) => window.api.pickDirectory(current),
    onClose: () => this.exitSettings(),
  });

  private editor: EditorView | null = null;
  private settings: AppSettings | null = null;
  private presets: readonly RewritePreset[] = [];
  private theme: ThemeState = { mode: 'system', resolved: 'light' };
  /** Default folder per library, for the settings placeholders and the empty panels. */
  private defaultDirectories: Record<LibraryId, string> = { notes: '', prompts: '' };

  /** Id of the rewrite in flight, used to ignore events from a cancelled one. */
  private activeRewriteId: string | null = null;
  /** Family of the preset in flight, which decides how the result panel presents its actions. */
  private activeRewriteKind: PresetKind = 'agent-prompt';
  private rewriteBuffer = '';

  async start(): Promise<void> {
    const bootstrap = await window.api.bootstrap();
    this.settings = bootstrap.settings;
    this.presets = bootstrap.presets;
    this.defaultDirectories = { ...bootstrap.defaultDirectories };
    // Which build is running has to be answerable without leaving the window: an old
    // instance still in the tray silently swallows the launch of a newer one.
    requireElement<HTMLSpanElement>('status-version').textContent = `v${bootstrap.appVersion}`;

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
        toggleNotes: () => void this.toggleLibrary('notes'),
        togglePrompts: () => void this.toggleLibrary('prompts'),
        toggleSettings: () => this.toggleSettings(),
        cycleTheme: () => void this.cycleTheme(),
        escape: () => this.handleEscape(),
      }),
      callbacks: {
        onChange: (text) => this.handleChange(text),
      },
    });

    this.statusBar.updateCounts(initialText);
    this.tokenBadge.update(initialText);
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
    await this.setThemeMode(nextThemeMode(this.theme.mode));
    this.editor?.focus();
  }

  /**
   * Applies a theme mode, whether it came from the titlebar button or the settings page.
   *
   * The main process owns the decision and persists it, so the renderer never writes `themeMode`
   * through `updateSettings`: two writers would let the window background and the page disagree.
   */
  private async setThemeMode(mode: ThemeMode): Promise<void> {
    const state = await window.api.setThemeMode(mode);
    this.applyTheme(state);
    if (this.settings !== null) {
      this.settings = { ...this.settings, themeMode: state.mode };
    }
    this.statusBar.setMessage(`thème : ${describeThemeMode(state.mode)}`);
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

  /* ------------------------------------------------------------- settings */

  private toggleSettings(): void {
    if (this.settingsPage.isOpen) {
      this.settingsPage.close();
      return;
    }
    if (this.settings === null) {
      return;
    }
    // The panel would sit behind the overlay, and its Escape handling is now second in line.
    this.panel.close();
    // The format bar and the toolbar act on the draft, which is not what is on screen any more.
    // Hiding them makes the overlay a page rather than a sheet floating over live controls.
    requireElement<HTMLDivElement>('app-root').classList.add('app--settings');
    this.settingsPage.show(this.settings, this.presets, this.defaultDirectories);
  }

  /** Restores the chrome the settings page hid, whether it was saved or cancelled. */
  private exitSettings(): void {
    requireElement<HTMLDivElement>('app-root').classList.remove('app--settings');
    this.editor?.focus();
  }

  /**
   * Commits the settings page.
   *
   * Everything lands at once here rather than field by field, and three of them need more than a
   * write to `settings.json`: the theme is owned by the main process, the pin state is mirrored
   * on a titlebar button, and the font size has to reach the live editor. The store returns the
   * sanitised result, so a value it clamped or rejected is what the renderer then remembers.
   */
  private async applySettings(next: AppSettings): Promise<void> {
    const previous = this.settings;

    this.settings = await window.api.updateSettings({
      globalShortcut: next.globalShortcut,
      alwaysOnTop: next.alwaysOnTop,
      hideOnBlur: next.hideOnBlur,
      openAtLogin: next.openAtLogin,
      fontSize: next.fontSize,
      model: next.model,
      modelByPresetId: next.modelByPresetId,
      claudePath: next.claudePath,
      maxBudgetUsd: next.maxBudgetUsd,
      notesDirectory: next.notesDirectory,
      promptsDirectory: next.promptsDirectory,
    });

    if (previous?.themeMode !== next.themeMode) {
      await this.setThemeMode(next.themeMode);
    }
    if (previous?.alwaysOnTop !== next.alwaysOnTop) {
      void window.api.setAlwaysOnTop(next.alwaysOnTop);
      this.reflectPinState(next.alwaysOnTop);
    }
    if (this.editor !== null) {
      applyEditorFontSize(this.editor, this.settings.fontSize);
    }
    this.statusBar.setMessage('réglages enregistrés');
  }

  /** Keeps the pin button in step with the setting, whichever control changed it. */
  private reflectPinState(pinned: boolean): void {
    requireElement<HTMLButtonElement>('pin-button').setAttribute('aria-pressed', String(pinned));
  }

  /* -------------------------------------------------------------- libraries */

  private async toggleLibrary(library: LibraryId): Promise<void> {
    if (this.panel.currentMode === library) {
      this.panel.close();
      this.editor?.focus();
      return;
    }
    await this.openLibrary(library);
  }

  /**
   * Shows one library.
   *
   * The two differ only in what a row does. A note is a working document, so it is loaded into
   * the editor; a prompt is reusable material, so it is copied to the clipboard and the draft is
   * left alone, which is the reason the two are kept in separate folders at all.
   */
  private async openLibrary(library: LibraryId): Promise<void> {
    const spec = LIBRARIES[library];
    const entries = await window.api.listLibrary(library);
    this.panel.open(library, `${spec.title} · ${entries.length}`);

    this.panel.setContent(
      entries.length === 0
        ? renderLibraryEmpty(spec.empty, this.directoryOf(library))
        : renderLibraryList(entries, {
            onActivate: (entry) => void this.activateEntry(library, entry),
            activateHint: spec.activateHint,
            // Replacing an entry with the draft makes sense for a working document, not for a
            // prompt that is copied out and never loaded in.
            onOverwrite:
              library === 'notes' ? (entry) => void this.overwriteEntry(library, entry) : null,
            onDelete: (entry) => void this.deleteEntry(library, entry),
          }),
    );
    this.panel.setActions([
      {
        label: spec.saveLabel,
        variant: 'primary',
        title: 'Nommé d’après la première ligne du brouillon',
        onClick: () => void this.saveDraftTo(library),
      },
    ]);
  }

  private async saveDraftTo(library: LibraryId): Promise<void> {
    if (this.editor === null) {
      return;
    }
    const text = getText(this.editor);
    if (text.trim().length === 0) {
      this.toast.show('Rien à enregistrer');
      return;
    }
    try {
      const entry = await window.api.saveToLibrary(library, text);
      await this.openLibrary(library);
      this.toast.show(`Enregistré : ${entry.id}`);
    } catch (error) {
      this.statusBar.setMessage(`enregistrement impossible: ${describeError(error)}`, true);
    }
  }

  private async activateEntry(library: LibraryId, entry: LibraryEntry): Promise<void> {
    if (library === 'prompts') {
      await this.copyEntry(entry);
      return;
    }
    await this.loadEntry(entry);
  }

  /**
   * Copies a prompt to the clipboard.
   *
   * Deliberately does not touch the draft: grabbing a frequently used prompt should not cost
   * whatever is currently being written. The panel stays open, so several can be taken in a row.
   */
  private async copyEntry(entry: LibraryEntry): Promise<void> {
    try {
      const text = await window.api.readLibraryEntry('prompts', entry.id);
      await window.api.writeClipboard(text);
      this.toast.show('Prompt copié, collez avec Ctrl+V');
    } catch (error) {
      this.statusBar.setMessage(`lecture impossible: ${describeError(error)}`, true);
    }
  }

  /**
   * Loads a note into the editor.
   *
   * Same contract as restoring a snapshot: the draft is archived first, then replaced in a single
   * transaction, so one `Ctrl+Z` brings it back. Notes are a library, not a second live buffer,
   * so nothing binds the editor to the note afterwards.
   */
  private async loadEntry(entry: LibraryEntry): Promise<void> {
    if (this.editor === null) {
      return;
    }
    try {
      const text = await window.api.readLibraryEntry('notes', entry.id);
      const current = getText(this.editor);
      if (current.trim().length > 0) {
        await window.api.snapshotDraft(current, 'restore');
      }
      replaceAll(this.editor, text);
      this.panel.close();
      this.editor.focus();
      this.toast.show('Note chargée · Ctrl+Z pour revenir');
    } catch (error) {
      this.statusBar.setMessage(`lecture impossible: ${describeError(error)}`, true);
    }
  }

  private async overwriteEntry(library: LibraryId, entry: LibraryEntry): Promise<void> {
    if (this.editor === null) {
      return;
    }
    const text = getText(this.editor);
    if (text.trim().length === 0) {
      this.toast.show('Rien à enregistrer');
      return;
    }
    try {
      await window.api.overwriteLibraryEntry(library, entry.id, text);
      await this.openLibrary(library);
      this.toast.show('Contenu remplacé');
    } catch (error) {
      this.statusBar.setMessage(`écriture impossible: ${describeError(error)}`, true);
    }
  }

  private async deleteEntry(library: LibraryId, entry: LibraryEntry): Promise<void> {
    try {
      await window.api.deleteLibraryEntry(library, entry.id);
      await this.openLibrary(library);
      this.toast.show('Supprimé');
    } catch (error) {
      this.statusBar.setMessage(`suppression impossible: ${describeError(error)}`, true);
    }
  }

  /** The folder a library actually uses, for the empty state. */
  private directoryOf(library: LibraryId): string {
    const configured =
      library === 'notes'
        ? (this.settings?.notesDirectory.trim() ?? '')
        : (this.settings?.promptsDirectory.trim() ?? '');
    return configured.length > 0 ? configured : this.defaultDirectories[library];
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
    this.tokenBadge.update(text);
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
    // Settings first: they cover the panel, so closing what is underneath would look like
    // nothing happened.
    if (this.settingsPage.isOpen) {
      this.settingsPage.close();
      return;
    }
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

  /**
   * Fills the picker, one `<optgroup>` per preset family.
   *
   * The two families answer different questions ("reshape my prompt" versus "give me a text to
   * send"), and a flat list of six entries hid that. A group with no member is skipped rather
   * than rendered empty, so a configuration that drops a whole family leaves no dangling header.
   */
  private renderPresets(): void {
    const select = requireElement<HTMLSelectElement>('preset-select');
    select.replaceChildren();

    for (const [kind, groupLabel] of PRESET_GROUPS) {
      const members = this.presets.filter((preset) => preset.kind === kind);
      if (members.length === 0) {
        continue;
      }
      const group = document.createElement('optgroup');
      group.label = groupLabel;
      for (const preset of members) {
        const option = createElement('option', { text: preset.label, title: preset.hint });
        option.value = preset.id;
        group.append(option);
      }
      select.append(group);
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
    this.activeRewriteKind = preset?.kind ?? 'agent-prompt';
    this.panel.open('rewrite', `Réécriture · ${preset?.label ?? presetId}`, () => {
      if (this.activeRewriteId !== null) {
        void window.api.cancelRewrite(this.activeRewriteId);
      }
    });
    this.panel.setPending('Rédaction en cours…');
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

    // A `text` result is meant to be sent somewhere else, not to become the draft, so copying
    // is the primary action there. Applying stays available: it is snapshotted and undoable.
    const apply = {
      label: 'Appliquer',
      title: 'Remplace le texte (Ctrl+Z pour revenir)',
      onClick: () => void this.applyRewrite(text),
    };
    const copy = { label: 'Copier', onClick: () => void this.copyRewrite(text) };
    const retry = { label: 'Relancer', onClick: () => void this.retryRewrite() };

    this.panel.setActions(
      this.activeRewriteKind === 'text'
        ? [
            { ...copy, variant: 'primary' },
            { ...apply, variant: 'accent' },
            retry,
          ]
        : [
            { ...apply, variant: 'primary' },
            { ...copy, variant: 'accent' },
            retry,
          ],
    );
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

    await this.openHistory();
  }

  private async openHistory(): Promise<void> {
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
    this.panel.setFooterNodes(
      confirmButton({
        label: 'Tout supprimer',
        armedLabel: `Confirmer (${entries.length})`,
        title: 'Supprime tous les instantanés. Le brouillon en cours et les notes ne sont pas touchés.',
        onConfirm: () => void this.clearHistory(),
      }),
    );
  }

  /**
   * Empties the snapshot archive.
   *
   * Safe to offer because snapshots are the disposable copy: the draft itself is untouched, and
   * anything worth keeping belongs in a note. Two clicks are required, in the button itself.
   */
  private async clearHistory(): Promise<void> {
    try {
      const removed = await window.api.clearHistory();
      await this.openHistory();
      this.toast.show(removed === 0 ? 'Rien à supprimer' : `${removed} instantanés supprimés`);
    } catch (error) {
      this.statusBar.setMessage(`suppression impossible: ${describeError(error)}`, true);
    }
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
    this.reflectPinState(this.settings?.alwaysOnTop ?? true);
    pin.addEventListener('click', () => {
      const next = pin.getAttribute('aria-pressed') !== 'true';
      this.reflectPinState(next);
      void window.api.setAlwaysOnTop(next);
      if (this.settings !== null) {
        this.settings = { ...this.settings, alwaysOnTop: next };
      }
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
    requireElement<HTMLButtonElement>('notes-button').addEventListener('click', () => {
      void this.toggleLibrary('notes');
    });
    requireElement<HTMLButtonElement>('prompts-button').addEventListener('click', () => {
      void this.toggleLibrary('prompts');
    });
    requireElement<HTMLButtonElement>('settings-button').addEventListener('click', () => {
      this.toggleSettings();
    });
    requireElement<HTMLButtonElement>('quit-button').addEventListener('click', () => {
      // Goes to the main process, which flushes the draft, archives a last snapshot and saves
      // the bounds before exiting. Nothing is lost, so no confirmation is warranted.
      window.api.quitApp();
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
 * How each library presents itself.
 *
 * Wording is the only real difference between the two, so it lives in one table rather than being
 * threaded through the render path as arguments.
 */
const LIBRARIES: Readonly<
  Record<LibraryId, { title: string; empty: string; saveLabel: string; activateHint: string }>
> = {
  notes: {
    title: 'Notes',
    empty:
      'Aucune note. « Enregistrer le brouillon » en crée une, nommée d’après sa première ligne.',
    saveLabel: 'Enregistrer le brouillon',
    activateHint: 'Charger dans l’éditeur',
  },
  prompts: {
    title: 'Bibliothèque',
    empty:
      'Aucun prompt enregistré. « Enregistrer le prompt » range le brouillon courant ici, pour le recopier ensuite en un clic.',
    saveLabel: 'Enregistrer le prompt',
    activateHint: 'Copier dans le presse-papier',
  },
};

/** Picker groups, in display order. The label says what the preset *produces*. */
const PRESET_GROUPS: readonly (readonly [PresetKind, string])[] = [
  ['agent-prompt', 'Prompt'],
  ['text', 'Texte'],
];

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
