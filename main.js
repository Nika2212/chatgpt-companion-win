const { app, BrowserWindow, View, WebContentsView, shell, globalShortcut } = require('electron');
const path = require('path');

// Taskbar groups and shows the app icon under this ID (matches build.appId).
app.setAppUserModelId('com.local.chatgpt-companion');

const CHAT_URL = 'https://chatgpt.com/?temporary-chat=true';
const PARTITION = 'persist:chatgpt'; // keeps you signed in between launches

// Sign-in (Google in particular) rejects embedded browsers that look inconsistent. Use Electron's own
// real Chromium user agent with only the "Electron/x" and app-name tokens removed. It is set as the
// default (not a per-page override), so the Sec-CH-UA client hints and navigator.userAgentData stay
// consistent with it.
const CHROME_UA = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(/\(KHTML, like Gecko\).*?Chrome\//, '(KHTML, like Gecko) Chrome/'); // drops the app-name token
app.userAgentFallback = CHROME_UA;
console.log('[ua]', CHROME_UA);

// Diagnostics: logs navigations (host + path only, no query strings), load failures and page errors.
const short = (url) => { try { const u = new URL(url); return u.host + u.pathname; } catch { return url; } };
function attachDebugLog(wc, tag) {
  const log = (...a) => console.log(`[${tag}]`, ...a);
  wc.on('did-start-navigation', (d) => d.isMainFrame && log('start', short(d.url)));
  wc.on('will-redirect', (_e, url) => log('redirect', short(url)));
  wc.on('will-navigate', (_e, url) => log('will-navigate', short(url), isInApp(url) ? '' : '(BLOCKED -> external)'));
  wc.on('did-navigate', (_e, url, code) => log('navigated', code, short(url)));
  wc.on('did-fail-load', (_e, code, desc, url, main) => main && log('FAIL', code, desc, short(url)));
  wc.on('render-process-gone', (_e, d) => log('RENDERER GONE', d.reason));
  wc.on('console-message', (e) => { if (e.level === 'error') log('console error:', String(e.message).slice(0, 200)); });
}

// Hosts allowed to open in-app (sign-in flows); everything else goes to the default browser.
const IN_APP_HOSTS = [
  'chatgpt.com', 'openai.com', 'auth.openai.com', 'auth0.openai.com',
  'accounts.google.com', 'login.microsoftonline.com', 'login.live.com',
  'appleid.apple.com', 'challenges.cloudflare.com',
];
const isInApp = (url) => {
  try {
    const h = new URL(url).hostname;
    return IN_APP_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch { return false; }
};

// No title bar: the window is dragged by ChatGPT's own header (and a thin invisible strip along the top edge).
const DRAG_CSS = `
  #page-header, header { -webkit-app-region: drag; }
  #page-header button, #page-header a, #page-header input, #page-header [role="button"],
  #page-header [role="combobox"], header button, header a, header input,
  header [role="button"], header [role="combobox"] { -webkit-app-region: no-drag; }
  html::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: 6px;
    -webkit-app-region: drag; z-index: 2147483647; }
`;

// The page is drawn at 90% opacity over Windows' acrylic blur of whatever is behind the window.
// ChatGPT's own colours are untouched; only the page as a whole is faded.
const PAGE_OPACITY = 0.75;
// ChatGPT's background normally paints on the page canvas, which CSS opacity can't fade, so the
// same colour is moved onto <body> (html gets a near-invisible background to stop it propagating).
const opacityCss = (bg) => `
  html { background: rgba(0,0,0,0.004) !important; opacity: ${PAGE_OPACITY} !important; }
  body { background-color: ${bg} !important; min-height: 100vh; }`;

const WIDTH = 640;      // ~22% larger than the original 440x640
const HEIGHT = 960;
const BOTTOM_PAD = 12; // keeps ChatGPT's footer text clear of the rounded bottom corners

let win;

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    hasShadow: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  // ChatGPT lives in a child view inset from the bottom; the strip below it shows the window background.
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
  });
  view.setBackgroundColor('#00000000'); // let the acrylic show through the faded page
  win.contentView.addChildView(view);
  const [cw, ch] = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width: cw, height: ch - BOTTOM_PAD });
  // Bottom padding strip, filled with the page colour at the same opacity.
  const strip = new View();
  win.contentView.addChildView(strip);
  strip.setBounds({ x: 0, y: ch - BOTTOM_PAD, width: cw, height: BOTTOM_PAD });

  const wc = view.webContents;
  attachDebugLog(wc, 'main');
  wc.loadURL(CHAT_URL);
  wc.on('dom-ready', () => {
    wc.insertCSS(DRAG_CSS);
  });
  let opacityKey = null;
  const applyOpacity = async () => {
    try {
      if (opacityKey) { await wc.removeInsertedCSS(opacityKey); opacityKey = null; }
      const bg = await wc.executeJavaScript(`(() => {
        for (const el of [document.body, document.documentElement]) {
          const c = el && getComputedStyle(el).backgroundColor;
          if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c; }
        return matchMedia('(prefers-color-scheme: dark)').matches ? '#212121' : '#ffffff'; })()`);
      opacityKey = await wc.insertCSS(opacityCss(bg));
      const m = bg.match(/[\d.]+/g);
      if (m) {
        strip.setBackgroundColor(
            `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${PAGE_OPACITY})`
        );
      } else {
        strip.setBackgroundColor(bg);
      }
    } catch {}
  };
  wc.on('dom-ready', applyOpacity);
  wc.on('did-finish-load', applyOpacity);
  win.on('focus', () => wc.focus());

  // Keyboard controls, since there are no window buttons.
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const k = input.key.toLowerCase();
    if (ctrl && !input.shift && !input.alt && k === 'w') { e.preventDefault(); win.close(); }               // Ctrl+W  close
    else if (ctrl && input.alt && k === 'n') { e.preventDefault(); wc.loadURL(CHAT_URL); }                  // Ctrl+Alt+N  new temp chat
    else if (ctrl && !input.shift && k === 'r') { e.preventDefault(); wc.reload(); }                        // Ctrl+R  reload
    else if (ctrl && input.alt && k === 't') { e.preventDefault(); win.setAlwaysOnTop(!win.isAlwaysOnTop()); } // Ctrl+Alt+T  pin on top
    else if (ctrl && input.alt && k === 'm') { e.preventDefault(); win.minimize(); }                         // Ctrl+Alt+M  minimize
    else if (ctrl && input.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools(); }                  // Ctrl+Shift+I  DevTools
  });

  // Popups: sign-in providers open in a child window sharing the session; other links go to the OS browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isInApp(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 700, parent: win, autoHideMenuBar: true,
          webPreferences: { partition: PARTITION },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    attachDebugLog(child.webContents, 'popup');
  });

  wc.on('will-navigate', (e, url) => {
    if (!isInApp(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // After sign-in redirects back to plain chatgpt.com, force temporary mode again.
  wc.on('did-navigate', (_e, url) => {
    try {
      const u = new URL(url);
      if (u.hostname === 'chatgpt.com' && u.pathname === '/' && !u.searchParams.has('temporary-chat')) {
        wc.loadURL(CHAT_URL);
      }
    } catch {}
  });
}

app.whenReady().then(() => {
  createWindow();

  // Ctrl+Shift+Space toggles the window from anywhere.
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (win.isVisible() && win.isFocused()) win.hide();
    else { win.show(); win.focus(); }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
