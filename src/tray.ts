import fs from 'fs';
import path from 'path';
import { app, Menu, MenuItem, NativeImage, nativeImage, Tray } from 'electron';
import { EXE_PATH, ICON_PATH, LOGIN_SETTING_MARK_FILE } from './constants';
import { TrayCallbacks } from './types';

export function isStartAtLogin(): boolean {
  return app.getLoginItemSettings({ path: EXE_PATH, args: ['--hidden'] }).openAtLogin;
}

export function setStartAtLogin(openAtLogin: boolean): void {
  app.setLoginItemSettings({ openAtLogin, path: EXE_PATH, args: ['--hidden'] });
}

export function ensureFirstRunLoginSetting(): void {
  const firstRunMark: string = path.join(app.getPath('userData'), LOGIN_SETTING_MARK_FILE);
  if (app.isPackaged && !fs.existsSync(firstRunMark)) {
    setStartAtLogin(true);
    try {
      fs.writeFileSync(firstRunMark, '');
    } catch (err: unknown) {
      console.error('Failed to write first-run login setting marker:', err);
    }
  }
}

export function createTray(callbacks: TrayCallbacks): Tray {
  const image: NativeImage = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  const tray: Tray = new Tray(image);
  tray.setToolTip('ChatGPT Companion (Ctrl+Space)');

  const buildMenu: () => Menu = (): Menu =>
    Menu.buildFromTemplate([
      { label: 'Show / Hide\tCtrl+Space', click: (): void => callbacks.onToggle() },
      {
        label: 'Start at Windows sign-in',
        type: 'checkbox',
        checked: isStartAtLogin(),
        enabled: app.isPackaged,
        click: (item: MenuItem): void => setStartAtLogin(item.checked),
      },
      { type: 'separator' },
      { label: 'Quit', click: (): void => callbacks.onQuit() },
    ]);

  tray.on('click', (): void => callbacks.onToggle());
  tray.on('right-click', (): void => {
    tray.popUpContextMenu(buildMenu());
  });

  return tray;
}
