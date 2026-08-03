import { Menu, Tray, app, nativeImage } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Tray icon: the app's only visible presence when the popup is hidden.
 *
 * It also holds the single genuine "Quitter" action. Every other close gesture merely
 * hides the window, so quitting stays a deliberate choice rather than an accident.
 */
export function createTray(actions: {
  onToggle: () => void;
  onQuit: () => void;
  shortcutLabel: string;
}): Tray {
  const tray = new Tray(loadTrayIcon());
  tray.setToolTip(`Oxum Prompt Editor (${actions.shortcutLabel})`);

  const menu = Menu.buildFromTemplate([
    { label: `Afficher / masquer (${actions.shortcutLabel})`, click: actions.onToggle },
    { type: 'separator' },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quitter', click: actions.onQuit },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', actions.onToggle);
  return tray;
}

/**
 * Loads the tray icon, falling back to a generated one.
 *
 * An empty `nativeImage` would render as an invisible tray entry, leaving the app
 * unreachable once hidden, so the fallback is drawn rather than left blank.
 */
function loadTrayIcon(): Electron.NativeImage {
  for (const candidate of [
    join(__dirname, '../../resources/tray.png'),
    join(process.resourcesPath, 'tray.png'),
  ]) {
    if (existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) {
        return image.resize({ width: 16, height: 16 });
      }
    }
  }
  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

/** 16x16 rounded square with a pen stroke, inlined so the app never ships without an icon. */
const FALLBACK_ICON_DATA_URL =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#5b8def"/>
      <path d="M4.5 11.5l1-2.5 4-4 1.5 1.5-4 4z" fill="#ffffff"/>
      <rect x="4.5" y="11.8" width="7" height="1" rx="0.5" fill="#ffffff" opacity="0.7"/>
    </svg>`,
  ).toString('base64');
