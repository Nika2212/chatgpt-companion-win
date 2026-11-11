import { PAGE_OPACITY } from './constants';

export const COMPANION_CSS: string = `
  #page-header, header { -webkit-app-region: drag; }
  #page-header button, #page-header a, #page-header input, #page-header [role="button"],
  #page-header [role="combobox"], header button, header a, header input,
  header [role="button"], header [role="combobox"] { -webkit-app-region: no-drag; }
  button[data-testid="sidebar-toggle-button"],
  button[aria-label*="sidebar" i],
  button[title*="sidebar" i],
  button[aria-label="Toggle sidebar"],
  button[aria-label="Show sidebar"],
  button[aria-label="Hide sidebar"],
  button[title^="Toggle sidebar"] { display: none !important; }
  #stage-slideover-sidebar,
  [data-testid^="sidebar"],
  [aria-label="Chat history"],
  [role="dialog"][aria-label*="sidebar" i],
  nav[aria-label="Chat history"] { display: none !important; }
  button[data-testid="create-new-chat-button"],
  button[aria-label="New chat"],
  button[title^="New chat"] { display: none !important; }
  button[data-testid="temporary-chat-toggle"],
  button[aria-label="Turn off temporary chat" i],
  button[title^="Turn off temporary chat" i] { display: none !important; }
  html::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: 6px;
    -webkit-app-region: drag; z-index: 2147483647; }
  html { background: rgba(0,0,0,0.004) !important; opacity: ${PAGE_OPACITY} !important; }
  html, body { overflow: hidden !important; }
  html.dark body, html[data-theme="dark"] body {
    background-color: #212121 !important;
    min-height: 100vh;
  }
  html.light body, html:not(.dark) body {
    background-color: #ffffff !important;
    min-height: 100vh;
  }
  @media (prefers-color-scheme: dark) {
    html:not(.light) body {
      background-color: #212121 !important;
      min-height: 100vh;
    }
  }
  @media (prefers-color-scheme: light) {
    html:not(.dark) body {
      background-color: #ffffff !important;
      min-height: 100vh;
    }
  }
`;

export const DRAG_CSS: string = COMPANION_CSS;
export const BASE_OPACITY_CSS: string = COMPANION_CSS;

export function createOpacityCss(bg: string): string {
  return `
  html { background: rgba(0,0,0,0.004) !important; opacity: ${PAGE_OPACITY} !important; }
  body { background-color: ${bg} !important; min-height: 100vh; }
  html, body { overflow: hidden !important; }`;
}
