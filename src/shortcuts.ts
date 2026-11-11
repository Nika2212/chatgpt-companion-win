import { globalShortcut } from 'electron';
import { FALLBACK_TOGGLE_KEY, TOGGLE_KEY } from './constants';

export function registerGlobalShortcuts(onToggle: () => void): void {
  const registered: boolean = globalShortcut.register(TOGGLE_KEY, onToggle);
  if (!registered) {
    console.log(
      `[shortcut] ${TOGGLE_KEY} is taken by another app; using ${FALLBACK_TOGGLE_KEY} instead`
    );
    globalShortcut.register(FALLBACK_TOGGLE_KEY, onToggle);
  }
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}
