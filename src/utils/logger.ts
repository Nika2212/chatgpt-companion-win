import {
  Event,
  RenderProcessGoneDetails,
  WebContents,
  WebContentsConsoleMessageEventParams,
  WebContentsDidStartNavigationEventParams,
  WebContentsWillNavigateEventParams,
  WebContentsWillRedirectEventParams,
} from 'electron';
import { isInApp, shortUrl } from './url';

export function attachDebugLog(wc: WebContents, tag: string): void {
  const log: (...args: unknown[]) => void = (...args: unknown[]): void => {
    console.log(`[${tag}]`, ...args);
  };

  wc.on('did-start-navigation', (details: Event<WebContentsDidStartNavigationEventParams>): void => {
    if (details.isMainFrame) {
      log('start', shortUrl(details.url));
    }
  });

  wc.on('will-redirect', (details: Event<WebContentsWillRedirectEventParams>): void => {
    log('redirect', shortUrl(details.url));
  });

  wc.on('will-navigate', (details: Event<WebContentsWillNavigateEventParams>): void => {
    log('will-navigate', shortUrl(details.url), isInApp(details.url) ? '' : '(BLOCKED -> external)');
  });

  wc.on('did-navigate', (_event: Event, url: string, code: number): void => {
    log('navigated', code, shortUrl(url));
  });

  wc.on('did-fail-load', (_event: Event, code: number, desc: string, url: string, isMainFrame: boolean): void => {
    if (isMainFrame) {
      log('FAIL', code, desc, shortUrl(url));
    }
  });

  wc.on('render-process-gone', (_event: Event, details: RenderProcessGoneDetails): void => {
    log('RENDERER GONE', details.reason);
  });

  wc.on('console-message', (details: Event<WebContentsConsoleMessageEventParams>): void => {
    const isError: boolean = details.level === 'error';
    if (isError) {
      log('console error:', String(details.message).slice(0, 200));
    }
  });
}
