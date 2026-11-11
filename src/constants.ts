import path from 'path';
import { Coordinates } from './types';

export const APP_ID: string = 'com.local.chatgpt-companion';

export const CHAT_URL: string = 'https://chatgpt.com/?temporary-chat=true';
export const PARTITION: string = 'persist:chatgpt';

export const IN_APP_HOSTS: readonly string[] = [
  'chatgpt.com',
  'openai.com',
  'auth.openai.com',
  'auth0.openai.com',
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'challenges.cloudflare.com',
];

export const WINDOW_WIDTH: number = 640;
export const WINDOW_HEIGHT: number = 960;
export const PAGE_OPACITY: number = 0.75;

export const ANIMATION_DURATION: number = 250;
export const ANIMATION_INTERVAL: number = 16;
export const POSITION_ANIMATION_OFFSET: number = 50;

export const PARKED_POSITION: Coordinates = { x: -32000, y: -32000 };

export const TOGGLE_KEY: string = 'Control+Space';
export const FALLBACK_TOGGLE_KEY: string = 'Control+Shift+Space';

export const START_HIDDEN: boolean = process.argv.includes('--hidden');
export const EXE_PATH: string = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

export const LOGIN_SETTING_MARK_FILE: string = 'login-item-set';

export function getAssetPath(...paths: string[]): string {
  return path.join(__dirname, '..', 'assets', ...paths);
}

export const ICON_PATH: string = getAssetPath('icon.png');
