import { BrowserWindow, WebContentsView, ipcMain, shell } from "electron";
import {
  isAllowedCloudDesktopNavigation,
  isAllowedCloudDesktopPermission,
  isValidCloudDesktopBotId,
  prepareCloudDesktopUrl,
  sanitizeCloudDesktopBounds,
  sanitizeCloudDesktopError,
} from "./cloud-desktop-utils.mjs";

const PARTITION = "xinyun-cloud-desktop";
const controllers = new Map();
let registered = false;

function statePayload(controller) {
  return {
    state: controller.state,
    botId: controller.botId,
    message: controller.message,
    fullscreen: !controller.win.isDestroyed() && controller.win.isFullScreen(),
  };
}

class CloudDesktopController {
  constructor(win, getServerPort, onClosed) {
    this.win = win;
    this.getServerPort = getServerPort;
    this.onClosed = onClosed;
    this.view = null;
    this.botId = null;
    this.state = "closed";
    this.message = undefined;
    this.operation = 0;
    this.bounds = null;

    this.onFullscreenChanged = () => this.emit();
    // A WebContentsView is drawn above the renderer, but on Windows the
    // parent BrowserWindow can retain the native keyboard target after an
    // overlay transition. Relay parent key events only while this remote
    // desktop is active, so noVNC receives the same events as a standalone
    // browser tab. This also keeps the app's global shortcuts out of a live
    // remote session.
    this.forwardKeyboardInput = (event, input) => {
      const view = this.view;
      if (
        this.state !== "ready" ||
        !view ||
        view.webContents.isDestroyed() ||
        !["keyDown", "keyUp", "char", "rawKeyDown"].includes(input.type)
      ) {
        return;
      }
      try {
        view.webContents.sendInputEvent(input);
        event.preventDefault();
      } catch {
        // A view can be torn down between the check and native dispatch.
      }
    };
    this.primeInputTarget = (webContents = this.view?.webContents) => {
      if (!webContents || webContents.isDestroyed()) return;
      // noVNC versions in Box use one of these focusable targets. Chromium's
      // native focus is necessary but not sufficient after a WebContentsView
      // is re-attached: the RFB client also needs its hidden keyboard input
      // element focused before it starts translating DOM key events.
      void webContents
        .executeJavaScript(
          `(() => {
            const selectors = [
              "#noVNC_keyboardinput",
              "#noVNC_keyboardinput_helper",
              "input[autofocus]",
              "textarea[autofocus]",
              "canvas[tabindex]",
              "[tabindex=0]",
              "body",
            ];
            for (const selector of selectors) {
              const node = document.querySelector(selector);
              if (!node || typeof node.focus !== "function") continue;
              try { node.focus({ preventScroll: true }); } catch { node.focus(); }
              break;
            }
            window.focus();
            return document.activeElement?.id || document.activeElement?.tagName || "";
          })()`,
          true,
        )
        .catch(() => {});
    };
    win.on("enter-full-screen", this.onFullscreenChanged);
    win.on("leave-full-screen", this.onFullscreenChanged);
    win.webContents.on("before-input-event", this.forwardKeyboardInput);
    win.once("closed", () => {
      this.operation += 1;
      this.destroyView();
      this.onClosed();
    });
  }

  emit(state = this.state, message = this.message) {
    this.state = state;
    this.message = message;
    if (!this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
      this.win.webContents.send("cloud-desktop:state", statePayload(this));
    }
  }

  destroyView() {
    const view = this.view;
    this.view = null;
    if (!view) return;
    try {
      this.win.contentView.removeChildView(view);
    } catch {}
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    } catch {}
  }

  async requestJoinUrl(botId) {
    const port = this.getServerPort();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/bots/${encodeURIComponent(botId)}/computer/join`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(120_000),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
    const url = prepareCloudDesktopUrl(body?.joinUrl);
    if (!url) throw new Error("桌面服务没有返回有效的 HTTPS 地址");
    return url;
  }

  configureView(view, operation, allowedOrigins) {
    const { webContents } = view;
    const denyNavigation = (event) => {
      const target = event?.url;
      if (!isAllowedCloudDesktopNavigation(target, allowedOrigins)) {
        event.preventDefault();
        if (operation === this.operation && view === this.view) {
          this.destroyView();
          this.emit("failed", "云端桌面拒绝了不受信任的页面跳转，请重新连接");
        }
      }
    };

    webContents.session.setPermissionCheckHandler((_webContents, permission) =>
      isAllowedCloudDesktopPermission(permission),
    );
    webContents.session.setPermissionRequestHandler((_webContents, permission, callback) =>
      callback(isAllowedCloudDesktopPermission(permission)),
    );
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    webContents.on("will-navigate", denyNavigation);
    webContents.on("will-redirect", denyNavigation);
    webContents.on("did-start-loading", () => {
      if (operation !== this.operation || view !== this.view) return;
      view.setVisible(false);
      this.emit(this.state === "reconnecting" ? "reconnecting" : "connecting");
    });
    webContents.on("did-finish-load", () => {
      if (operation !== this.operation || view !== this.view) return;
      view.setVisible(true);
      // A WebContentsView does not always become the active input target after
      // a React overlay opens. Focus it explicitly so keyboard input reaches
      // the noVNC/Chromium client immediately.
      this.win.focus({ steal: true });
      webContents.focus();
      // noVNC listens on a hidden keyboard target. Focusing the document after
      // the native view is attached avoids a compositor focus race on Windows.
      this.primeInputTarget(webContents);
      // The noVNC page can mount its keyboard target a tick after the initial
      // load event. Repeat once after layout so a reconnect does not regress
      // to a mouse-only session.
      setTimeout(() => {
        if (operation === this.operation && view === this.view) this.primeInputTarget(webContents);
      }, 250);
      this.emit("ready");
    });
    webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || operation !== this.operation || view !== this.view) return;
      this.destroyView();
      this.emit(
        "failed",
        sanitizeCloudDesktopError(errorDescription, "云端桌面页面加载失败，请重新连接"),
      );
    });
    webContents.on("render-process-gone", () => {
      if (operation !== this.operation || view !== this.view) return;
      this.destroyView();
      this.emit("failed", "云端桌面页面异常退出，请重新连接");
    });
  }

  async open(botId, reconnecting = false) {
    if (!isValidCloudDesktopBotId(botId)) {
      this.emit("failed", "机器人标识无效，无法打开云端桌面");
      return { ok: false };
    }

    const operation = ++this.operation;
    this.destroyView();
    this.botId = botId;
    this.emit(reconnecting ? "reconnecting" : "connecting", undefined);

    try {
      const url = await this.requestJoinUrl(botId);
      if (operation !== this.operation || this.win.isDestroyed()) return { ok: false };

      const view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          partition: PARTITION,
        },
      });
      this.view = view;
      view.setVisible(false);
      if (this.bounds) view.setBounds(this.bounds);
      this.configureView(view, operation, new Set([url.origin]));
      this.win.contentView.addChildView(view);
      await view.webContents.loadURL(url.href);
      return operation === this.operation && view === this.view ? { ok: true } : { ok: false };
    } catch (error) {
      if (operation !== this.operation) return { ok: false };
      this.destroyView();
      this.emit("failed", sanitizeCloudDesktopError(error));
      return { ok: false };
    }
  }

  async openInBrowser(botId) {
    if (!isValidCloudDesktopBotId(botId)) {
      this.emit("failed", "机器人标识无效，无法打开云端桌面");
      return { ok: false };
    }

    try {
      // Use the operating system's browser as a robust input fallback for
      // Windows builds where an embedded WebContentsView cannot receive RFB
      // keyboard events. The rotating join URL stays in the main process.
      const url = await this.requestJoinUrl(botId);
      await shell.openExternal(url.href);
      return { ok: true };
    } catch (error) {
      this.emit("failed", sanitizeCloudDesktopError(error));
      return { ok: false };
    }
  }

  setBounds(bounds) {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const safe = sanitizeCloudDesktopBounds(bounds, { width, height });
    if (!safe) throw new Error("invalid cloud desktop bounds");
    this.bounds = safe;
    if (this.view) this.view.setBounds(safe);
  }

  reload() {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    this.emit("connecting", undefined);
    this.view.setVisible(false);
    this.view.webContents.reload();
  }

  focus() {
    if (!this.view || this.view.webContents.isDestroyed()) return false;
    this.view.webContents.focus();
    return true;
  }

  paste() {
    if (!this.focus()) return false;
    // This is Electron's native paste command. The clipboard text never
    // crosses IPC, is never sent to the app server, and is never logged.
    this.view.webContents.paste();
    return true;
  }

  close() {
    this.operation += 1;
    this.destroyView();
    this.botId = null;
    if (!this.win.isDestroyed() && this.win.isFullScreen()) this.win.setFullScreen(false);
    this.emit("closed", undefined);
  }

  toggleFullscreen() {
    if (this.win.isDestroyed()) return false;
    const next = !this.win.isFullScreen();
    this.win.setFullScreen(next);
    return next;
  }

  dispose() {
    this.operation += 1;
    this.destroyView();
    if (!this.win.isDestroyed()) {
      this.win.removeListener("enter-full-screen", this.onFullscreenChanged);
      this.win.removeListener("leave-full-screen", this.onFullscreenChanged);
      this.win.webContents.removeListener("before-input-event", this.forwardKeyboardInput);
    }
  }
}

function controllerFor(event, getServerPort) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.webContents !== event.sender) throw new Error("invalid cloud desktop IPC sender");
  let controller = controllers.get(win.id);
  if (!controller) {
    controller = new CloudDesktopController(win, getServerPort, () => controllers.delete(win.id));
    controllers.set(win.id, controller);
  }
  return controller;
}

export function registerCloudDesktopIpc(getServerPort) {
  if (registered) return;
  registered = true;
  ipcMain.handle("cloud-desktop:open", (event, botId) => controllerFor(event, getServerPort).open(botId));
  ipcMain.handle("cloud-desktop:reconnect", (event, botId) =>
    controllerFor(event, getServerPort).open(botId, true),
  );
  ipcMain.handle("cloud-desktop:open-in-browser", (event, botId) =>
    controllerFor(event, getServerPort).openInBrowser(botId),
  );
  ipcMain.handle("cloud-desktop:set-bounds", (event, bounds) => {
    controllerFor(event, getServerPort).setBounds(bounds);
  });
  ipcMain.handle("cloud-desktop:reload", (event) => controllerFor(event, getServerPort).reload());
  ipcMain.handle("cloud-desktop:focus", (event) => controllerFor(event, getServerPort).focus());
  ipcMain.handle("cloud-desktop:paste", (event) => controllerFor(event, getServerPort).paste());
  ipcMain.handle("cloud-desktop:close", (event) => controllerFor(event, getServerPort).close());
  ipcMain.handle("cloud-desktop:toggle-fullscreen", (event) =>
    controllerFor(event, getServerPort).toggleFullscreen(),
  );
  ipcMain.handle("cloud-desktop:get-state", (event) => statePayload(controllerFor(event, getServerPort)));
}

export function disposeAllCloudDesktops() {
  for (const controller of controllers.values()) controller.dispose();
  controllers.clear();
}
