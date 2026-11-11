const { app, BrowserWindow, View, WebContentsView, shell, globalShortcut, Tray, Menu, nativeImage, screen } = require('electron');
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
  body { background-color: ${bg} !important; min-height: 100vh; }
  html, body { overflow: hidden !important; } /* ChatGPT scrolls inside its own panes; stops a stray page scrollbar */`;

const WIDTH = 640;      // ~22% larger than the original 440x640
const HEIGHT = 960;
const BOTTOM_PAD = 12; // keeps ChatGPT's footer text clear of the rounded bottom corners

let win, tray;
let quitting = false;

const ICON = path.join(__dirname, 'assets', 'icon.png');
const TOGGLE_KEY = 'Control+Space';
// Launched by Windows at sign-in: start hidden and wait for Ctrl+Space.
const START_HIDDEN = process.argv.includes('--hidden');
// The portable build unpacks to a temp folder; this env var holds the real .exe location.
const EXE_PATH = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

let chatWc; // ChatGPT's webContents

// Keep the hidden window's page alive and painted, so showing it is instant (no grey frame).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// "Hidden" means parked off-screen, not win.hide(): Windows stops drawing truly hidden windows, so
// they come back as a grey blur for a moment. A parked window keeps its page painted, and showing it
// is just a move, so Ctrl+Space is instant.
const PARKED = { x: -32000, y: -32000 };
let parked = false;
let homePos = null; // where the window sits when shown

// Centre on the monitor under the mouse, kept inside its work area.
function centerOnCursorDisplay() {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x = Math.round(wa.x + Math.max(0, (wa.width - WIDTH) / 2));
  const y = Math.round(wa.y + Math.max(0, (wa.height - HEIGHT) / 2));
  placeAt(x, y);
}

// Position and size together: moving between monitors with different scaling (or back from the
// parking spot) can otherwise leave the window at the wrong scale. WIDTH/HEIGHT are in
// scaling-independent units, so the window is the same visual size on every monitor.
function placeAt(x, y) {
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
  // The first call moves the window onto the monitor (picking up its scaling); the second one
  // re-applies the size at that monitor's scale.
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function isShown() { return win.isVisible() && !parked; }

function showWindow() {
  if (parked) {
    win.setSkipTaskbar(false);
    // Back where it was, unless that spot is no longer on any monitor.
    const onScreen = homePos && screen.getAllDisplays().some(({ workArea: a }) =>
      homePos[0] >= a.x - 50 && homePos[0] < a.x + a.width && homePos[1] >= a.y - 50 && homePos[1] < a.y + a.height);
    if (onScreen) placeAt(homePos[0], homePos[1]);
    else centerOnCursorDisplay();
    parked = false;
  }
  if (!win.isVisible()) win.show();
  win.focus();
  if (chatWc) {
    chatWc.focus();
    chatWc.executeJavaScript(`document.querySelector('#prompt-textarea')?.focus()`).catch(() => {});
  }
}

// Hiding throws the chat away (it's temporary anyway) and loads a fresh one in the background,
// so the next Ctrl+Space shows a ready, empty temporary chat without any navigation.
function hideWindow() {
  if (!parked) {
    homePos = win.getPosition();
    parked = true;
    win.setPosition(PARKED.x, PARKED.y);
    win.setSkipTaskbar(true);
    win.blur(); // hands focus back to the previous window
  }
  if (chatWc) chatWc.loadURL(CHAT_URL);
}

function toggleWindow() {
  if (isShown() && win.isFocused()) hideWindow();
  else showWindow();
}

const isStartAtLogin = () => app.getLoginItemSettings({ path: EXE_PATH, args: ['--hidden'] }).openAtLogin;
function setStartAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: EXE_PATH, args: ['--hidden'] });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('ChatGPT Companion (Ctrl+Space)');
  const build = () => Menu.buildFromTemplate([
    { label: 'Show / Hide	Ctrl+Space', click: toggleWindow },
    { label: 'Start at Windows sign-in', type: 'checkbox', checked: isStartAtLogin(),
      enabled: app.isPackaged, click: (i) => setStartAtLogin(i.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(build()));
}

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
    icon: ICON,
    show: false,
  });
  // Always on screen (or parked off it) so the page stays painted; see hideWindow().
  if (START_HIDDEN) {
    homePos = null;
    parked = true;
    win.setPosition(PARKED.x, PARKED.y);
    win.setSkipTaskbar(true);
    win.showInactive();
  } else {
    win.show();
  }

  // Closing only hides the window so Ctrl+Space keeps working; quit from the tray menu or Ctrl+Q.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); hideWindow(); } });

  // ChatGPT lives in a child view inset from the bottom; the strip below it shows the window background.
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  view.setBackgroundColor('#00000000'); // let the acrylic show through the faded page
  win.contentView.addChildView(view);
  // Bottom padding strip, filled with the page colour at the same opacity.
  const strip = new View();
  win.contentView.addChildView(strip);
  const layout = () => {
    const [cw, ch] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width: cw, height: ch - BOTTOM_PAD });
    strip.setBounds({ x: 0, y: ch - BOTTOM_PAD, width: cw, height: BOTTOM_PAD });
  };
  layout();
  win.on('resize', layout); // e.g. after moving to a monitor with different scaling

  const wc = view.webContents;
  chatWc = wc;
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
    if (ctrl && !input.shift && !input.alt && k === 'w') { e.preventDefault(); hideWindow(); }              // Ctrl+W  hide
    else if (ctrl && !input.shift && !input.alt && k === 'q') { e.preventDefault(); quitting = true; app.quit(); } // Ctrl+Q  quit
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

// Only one copy runs; launching it again just shows the existing window.
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (win) showWindow(); });

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Packaged builds start hidden at Windows sign-in by default (toggle it in the tray menu).
  // Done once, on first run, so unticking it in the tray sticks.
  const firstRunMark = path.join(app.getPath('userData'), 'login-item-set');
  if (app.isPackaged && !require('fs').existsSync(firstRunMark)) {
    setStartAtLogin(true);
    try { require('fs').writeFileSync(firstRunMark, ''); } catch {}
  }

  // Ctrl+Space shows / hides the window from anywhere.
  if (!globalShortcut.register(TOGGLE_KEY, toggleWindow)) {
    console.log('[shortcut] Ctrl+Space is taken by another app; using Ctrl+Shift+Space instead');
    globalShortcut.register('Control+Shift+Space', toggleWindow);
  }
});

app.on('before-quit', () => { quitting = true; });

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
