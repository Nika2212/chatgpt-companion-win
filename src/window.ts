import {
  BrowserWindow,
  Display,
  Event,
  HandlerDetails,
  Input,
  Rectangle,
  screen,
  shell,
  WebContents,
  WebContentsDidStartNavigationEventParams,
  WebContentsView,
  WebContentsWillNavigateEventParams,
  WindowOpenHandlerResponse,
  app,
} from 'electron';
import {
  ANIMATION_DURATION,
  ANIMATION_INTERVAL,
  CHAT_URL,
  ICON_PATH,
  POSITION_ANIMATION_OFFSET,
  PARTITION,
  START_HIDDEN,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from './constants';
import { COMPANION_CSS } from './styles';
import { attachDebugLog } from './utils/logger';
import { isInApp } from './utils/url';

export class CompanionWindow {
  private win: BrowserWindow | null = null;
  private chatView: WebContentsView | null = null;
  private parked: boolean = false;
  private homePos: [number, number] | null = null;
  private quitting: boolean = false;
  private opacityInjected: boolean = false;
  private animationTimer: NodeJS.Timeout | null = null;
  private currentOpacity: number = 0;
  private targetOpacity: number = 0;
  private isPageReady: boolean = false;
  private didFinishLoad: boolean = false;
  private navigationGeneration: number = 0;
  private sidebarClosedGeneration: number = -1;
  private pendingShow: boolean = false;
  private sessionResetPending: boolean = false;

  public get window(): BrowserWindow | null {
    return this.win;
  }

  public get chatWebContents(): WebContents | null {
    return this.chatView?.webContents ?? null;
  }

  public isQuitting(): boolean {
    return this.quitting;
  }

  public setQuitting(quitting: boolean): void {
    this.quitting = quitting;
    if (this.animationTimer !== null) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  public create(): BrowserWindow {
    const wa: Rectangle = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const x: number = Math.round(wa.x + Math.max(0, (wa.width - WINDOW_WIDTH) / 2));
    const y: number = Math.round(wa.y + Math.max(0, (wa.height - WINDOW_HEIGHT) / 2));
    this.homePos = [x, y];

    this.win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      x: x,
      y: y + POSITION_ANIMATION_OFFSET,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundMaterial: 'acrylic',
      backgroundColor: '#00000000',
      hasShadow: true,
      icon: ICON_PATH,
      show: false,
    });

    if (START_HIDDEN) {
      this.parked = true;
      this.currentOpacity = 0;
      this.targetOpacity = 0;
      this.pendingShow = false;
      this.win.setOpacity(0);
      this.win.setIgnoreMouseEvents(true);
      this.win.setSkipTaskbar(true);
      this.win.showInactive();
    } else {
      this.parked = false;
      this.currentOpacity = 0;
      this.targetOpacity = 1;
      this.pendingShow = true;
      this.win.setOpacity(0);
      this.win.setSkipTaskbar(false);
      this.win.show();
    }

    this.win.on('close', (event: Event): void => {
      if (!this.quitting) {
        event.preventDefault();
        this.hide();
      }
    });

    this.setupViews();
    return this.win;
  }

  private setupViews(): void {
    if (!this.win || this.win.isDestroyed()) return;

    this.chatView = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.chatView.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.chatView);

    this.updateLayout();
    this.win.on('resize', (): void => {
      this.updateLayout();
    });

    this.setupChatWebContents();
  }

  private updateLayout(): void {
    if (!this.win || this.win.isDestroyed() || !this.chatView) return;
    const [cw, ch]: number[] = this.win.getContentSize();
    this.chatView.setBounds({ x: 0, y: 0, width: cw, height: ch });
  }

  private setupChatWebContents(): void {
    if (!this.win || this.win.isDestroyed() || !this.chatView) return;
    const wc: WebContents = this.chatView.webContents;

    attachDebugLog(wc, 'main');
    this.isPageReady = false;
    this.opacityInjected = false;
    void wc.loadURL(CHAT_URL).catch((): void => {});

    wc.on('did-start-navigation', (details: Event<WebContentsDidStartNavigationEventParams>): void => {
      if (details.isMainFrame) {
        this.navigationGeneration += 1;
        this.isPageReady = false;
        this.didFinishLoad = false;
        this.opacityInjected = false;
      }
    });

    wc.on('dom-ready', (): void => {
      void this.applyOpacity();
    });

    wc.on('did-finish-load', (): void => {
      this.didFinishLoad = true;
      void this.applyOpacity();
    });

    wc.on('did-fail-load', (_event: Event, errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
      if (!isMainFrame || errorCode === -3) return;
      this.didFinishLoad = true;
      void this.applyOpacity();
    });

    this.win.on('focus', (): void => {
      wc.focus();
    });

    this.setupKeyboardShortcuts(wc);
    this.setupNavigationHandlers(wc);
  }

  private async applyOpacity(): Promise<void> {
    if (!this.chatView || this.chatView.webContents.isDestroyed()) return;
    const wc: WebContents = this.chatView.webContents;
    const generation: number = this.navigationGeneration;

    try {
      if (!this.opacityInjected) {
        try {
          await wc.insertCSS(COMPANION_CSS);
        } catch {
          await wc.executeJavaScript(`(() => {
            let style = document.getElementById('__chatgpt_companion_styles');
            if (!style) {
              style = document.createElement('style');
              style.id = '__chatgpt_companion_styles';
              document.head.appendChild(style);
            }
            style.textContent = ${JSON.stringify(COMPANION_CSS)};
          })()`);
        }
        if (generation !== this.navigationGeneration) return;
        this.opacityInjected = true;
      }

      if (!this.didFinishLoad) return;
      if (this.sidebarClosedGeneration !== generation) {
        await wc.executeJavaScript(`(() => {
          const closeButton = document.querySelector(
            'button[aria-label="Hide sidebar"], button[aria-label="Close sidebar"], button[title="Hide sidebar"]'
          );
          closeButton?.click();
        })()`).catch((): void => {});
        if (generation !== this.navigationGeneration) return;
        this.sidebarClosedGeneration = generation;
      }
      await wc.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
        .catch((): void => {});
      if (generation !== this.navigationGeneration || !this.didFinishLoad) return;

      this.isPageReady = true;
      if (this.pendingShow) {
        this.pendingShow = false;
        this.show();
      }
    } catch {
      if (generation !== this.navigationGeneration || !this.didFinishLoad) return;
      console.error('[page] Could not apply companion styles; keeping the window hidden to avoid showing the unstyled page');
    }
  }

  private setupKeyboardShortcuts(wc: WebContents): void {
    wc.on('before-input-event', (event: Event, input: Input): void => {
      if (input.type !== 'keyDown') return;
      const ctrl: boolean = Boolean(input.control || input.meta);
      const k: string = input.key.toLowerCase();

      if (ctrl && input.shift && !input.alt && k === 's') {
        event.preventDefault();
      } else if (ctrl && !input.shift && !input.alt && k === 'w') {
        event.preventDefault();
        this.hide();
      } else if (ctrl && !input.shift && !input.alt && k === 'q') {
        event.preventDefault();
        this.quitting = true;
        app.quit();
      } else if (ctrl && input.alt && k === 'n') {
        event.preventDefault();
        this.isPageReady = false;
        this.opacityInjected = false;
        void wc.loadURL(CHAT_URL).catch((): void => {});
      } else if (ctrl && !input.shift && k === 'r') {
        event.preventDefault();
        this.isPageReady = false;
        this.opacityInjected = false;
        wc.reload();
      } else if (ctrl && input.alt && k === 't') {
        event.preventDefault();
        if (this.win && !this.win.isDestroyed()) {
          this.win.setAlwaysOnTop(!this.win.isAlwaysOnTop());
        }
      } else if (ctrl && input.alt && k === 'm') {
        event.preventDefault();
        if (this.win && !this.win.isDestroyed()) {
          this.win.minimize();
        }
      } else if (ctrl && input.shift && k === 'i') {
        event.preventDefault();
        wc.toggleDevTools();
      }
    });
  }

  private setupNavigationHandlers(wc: WebContents): void {
    wc.setWindowOpenHandler(({ url }: HandlerDetails): WindowOpenHandlerResponse => {
      if (isInApp(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 500,
            height: 700,
            parent: this.win ?? undefined,
            autoHideMenuBar: true,
            webPreferences: { partition: PARTITION },
          },
        };
      }
      void shell.openExternal(url).catch((): void => {});
      return { action: 'deny' };
    });

    wc.on('did-create-window', (child: BrowserWindow): void => {
      attachDebugLog(child.webContents, 'popup');
    });

    wc.on('will-navigate', (details: Event<WebContentsWillNavigateEventParams>): void => {
      if (!isInApp(details.url)) {
        details.preventDefault();
        void shell.openExternal(details.url).catch((): void => {});
      }
    });

    wc.on('did-navigate', (_event: Event, url: string): void => {
      try {
        const u: URL = new URL(url);
        if (u.hostname === 'chatgpt.com' && u.pathname === '/' && !u.searchParams.has('temporary-chat')) {
          void wc.loadURL(CHAT_URL).catch((): void => {});
        }
      } catch {
        return;
      }
    });
  }

  public placeAt(x: number, y: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.homePos = [x, y];
    this.win.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  }

  public centerOnCursorDisplay(): void {
    const wa: Rectangle = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const x: number = Math.round(wa.x + Math.max(0, (wa.width - WINDOW_WIDTH) / 2));
    const y: number = Math.round(wa.y + Math.max(0, (wa.height - WINDOW_HEIGHT) / 2));
    this.placeAt(x, y);
  }

  public isShown(): boolean {
    return Boolean(
      this.win &&
        !this.win.isDestroyed() &&
        this.win.isVisible() &&
        !this.parked &&
        this.currentOpacity > 0.05
    );
  }

  public show(): void {
    if (!this.win || this.win.isDestroyed()) return;

    if (this.sessionResetPending) {
      this.pendingShow = true;
      return;
    }

    // Keep the window hidden until the new page has its companion CSS and has
    // completed its first layout, avoiding a flash of ChatGPT's full navigation UI.
    if (!this.isPageReady) {
      this.pendingShow = true;
      return;
    }
    this.pendingShow = false;

    const cursorDisplay: Display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const currentBounds: Rectangle = this.win.getBounds();
    const currentDisplay: Display = screen.getDisplayMatching(currentBounds);

    if (cursorDisplay.id !== currentDisplay.id) {
      const wa: Rectangle = cursorDisplay.workArea;
      const x: number = Math.round(wa.x + Math.max(0, (wa.width - WINDOW_WIDTH) / 2));
      const y: number = Math.round(wa.y + Math.max(0, (wa.height - WINDOW_HEIGHT) / 2));
      this.homePos = [x, y];
      this.win.setPosition(x, y + POSITION_ANIMATION_OFFSET);
    }

    this.parked = false;
    this.win.setIgnoreMouseEvents(false);
    this.win.setSkipTaskbar(false);
    if (!this.win.isVisible()) {
      this.win.show();
    }
    this.win.focus();

    this.animateOpacity(1, (): void => {
      this.focusPrompt();
    }, this.homePos ? { x: this.homePos[0], y: this.homePos[1] } : undefined);
  }

  private focusPrompt(): void {
    if (!this.isPageReady || !this.chatView || this.chatView.webContents.isDestroyed()) return;
    const wc: WebContents = this.chatView.webContents;
    wc.focus();
    wc.executeJavaScript(`(() => {
      const el = document.querySelector('#prompt-textarea');
      if (el) el.focus({ preventScroll: true });
    })()`).catch((): void => {});
  }

  public hide(): void {
    if (!this.win || this.win.isDestroyed()) return;

    this.pendingShow = false;

    if (this.parked && this.currentOpacity === 0 && this.targetOpacity === 0) {
      return;
    }

    this.sessionResetPending = true;
    this.win.setIgnoreMouseEvents(true);
    const [x, y]: number[] = this.win.getPosition();
    if (this.animationTimer === null || !this.homePos) {
      this.homePos = [x, y];
    }
    this.animateOpacity(0, (): void => {
      if (!this.win || this.win.isDestroyed()) return;
      this.parked = true;
      this.win.setSkipTaskbar(true);
      this.win.blur();
      const wc: WebContents | null = this.chatWebContents;
      if (wc && !wc.isDestroyed()) {
        this.isPageReady = false;
        this.didFinishLoad = false;
        this.opacityInjected = false;
        this.sessionResetPending = false;
        void wc.loadURL(CHAT_URL).catch((): void => {});
      } else {
        this.sessionResetPending = false;
      }
    }, this.homePos
      ? { x: this.homePos[0], y: this.homePos[1] + POSITION_ANIMATION_OFFSET }
      : undefined);
  }

  public toggle(): void {
    if (!this.win || this.win.isDestroyed()) return;

    if (this.isShown() && this.win.isFocused() && this.targetOpacity === 1) {
      this.hide();
    } else {
      this.show();
    }
  }

  private animateOpacity(
    target: number,
    onComplete?: () => void,
    targetPosition?: { x: number; y: number }
  ): void {
    if (!this.win || this.win.isDestroyed() || this.quitting) return;

    if (this.animationTimer !== null) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }

    this.targetOpacity = target;
    const startOpacity: number = this.currentOpacity;
    const delta: number = target - startOpacity;
    const [startX, startY]: number[] = this.win.getPosition();
    const endX: number = targetPosition?.x ?? startX;
    const endY: number = targetPosition?.y ?? startY + (target === 0 ? POSITION_ANIMATION_OFFSET : 0);
    const positionDeltaX: number = endX - startX;
    const positionDeltaY: number = endY - startY;

    if (Math.abs(delta) < 0.01) {
      this.currentOpacity = target;
      this.win.setOpacity(target);
      this.win.setPosition(endX, endY);
      if (onComplete) {
        onComplete();
      }
      return;
    }

    const duration: number = ANIMATION_DURATION * Math.abs(delta);
    const startTime: number = Date.now();

    this.animationTimer = setInterval((): void => {
      if (!this.win || this.win.isDestroyed() || this.quitting) {
        if (this.animationTimer !== null) {
          clearInterval(this.animationTimer);
          this.animationTimer = null;
        }
        return;
      }

      const elapsed: number = Date.now() - startTime;
      const progress: number = Math.min(1, elapsed / duration);
      const eased: number = 1 - Math.pow(1 - progress, 3);

      this.currentOpacity = startOpacity + delta * eased;
      const clamped: number = Math.max(0, Math.min(1, this.currentOpacity));
      this.win.setOpacity(clamped);
      this.win.setPosition(
        Math.round(startX + positionDeltaX * eased),
        Math.round(startY + positionDeltaY * eased)
      );

      if (progress >= 1) {
        if (this.animationTimer !== null) {
          clearInterval(this.animationTimer);
          this.animationTimer = null;
        }
        this.currentOpacity = target;
        this.win.setOpacity(target);
        if (onComplete) {
          onComplete();
        }
      }
    }, ANIMATION_INTERVAL);
  }
}
