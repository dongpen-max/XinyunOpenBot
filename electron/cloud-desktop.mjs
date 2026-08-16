import { BrowserWindow, WebContentsView, ipcMain } from "electron";
import {
  isAllowedCloudDesktopNavigation,
  isValidCloudDesktopBotId,
  parseCloudDesktopUrl,
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
    win.on("enter-full-screen", this.onFullscreenChanged);
    win.on("leave-full-screen", this.onFullscreenChanged);
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
    const url = parseCloudDesktopUrl(body?.joinUrl);
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

    webContents.session.setPermissionCheckHandler(() => false);
    webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
  ipcMain.handle("cloud-desktop:set-bounds", (event, bounds) => {
    controllerFor(event, getServerPort).setBounds(bounds);
  });
  ipcMain.handle("cloud-desktop:reload", (event) => controllerFor(event, getServerPort).reload());
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
