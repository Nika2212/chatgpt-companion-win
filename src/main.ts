import { app } from 'electron';
import { APP_ID } from './constants';
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts';
import { createTray, ensureFirstRunLoginSetting } from './tray';
import { CompanionWindow } from './window';

app.setAppUserModelId(APP_ID);

const chromeUa: string = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(/\(KHTML, like Gecko\).*?Chrome\//, '(KHTML, like Gecko) Chrome/');
app.userAgentFallback = chromeUa;
console.log('[ua]', chromeUa);

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const gotSingleInstanceLock: boolean = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  const companionWindow: CompanionWindow = new CompanionWindow();

  app.on('second-instance', (): void => {
    companionWindow.show();
  });

  app.whenReady().then((): void => {
    companionWindow.create();

    createTray({
      onToggle: (): void => companionWindow.toggle(),
      onQuit: (): void => {
        companionWindow.setQuitting(true);
        app.quit();
      },
    });

    ensureFirstRunLoginSetting();

    registerGlobalShortcuts((): void => companionWindow.toggle());
  });

  app.on('before-quit', (): void => {
    companionWindow.setQuitting(true);
  });

  app.on('will-quit', (): void => {
    unregisterGlobalShortcuts();
  });

  app.on('window-all-closed', (): void => {
    app.quit();
  });
}
