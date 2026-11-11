import { IN_APP_HOSTS } from '../constants';

export function shortUrl(url: string): string {
  try {
    const u: URL = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

export function isInApp(url: string): boolean {
  try {
    const h: string = new URL(url).hostname;
    return IN_APP_HOSTS.some((d: string): boolean => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}
