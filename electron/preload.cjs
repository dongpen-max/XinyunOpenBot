// Renderer bridge. contextIsolation stays on; the renderer only ever sees
// this narrow surface (window.ogb), never Node or ipcRenderer itself.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("ogb", {
  /** Host platform ("darwin" | "win32" | "linux") — for platform-aware UI. */
  platform: process.platform,
  /** Electron 32+ removed File.path; expose only the selected file's path. */
  getPathForFile: (file) => webUtils.getPathForFile(file),
  /** Keep Windows caption buttons aligned with the selected app background. */
  setTitleBarColor: (color) => ipcRenderer.invoke("appearance:title-bar-color", color),
  /** One frame of this Mac's screen as a data: URL (Screen Recording TCC). */
  screenFrame: () => ipcRenderer.invoke("screen:frame"),
  speechStart: () => ipcRenderer.invoke("speech:start"),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  onSpeechTranscript: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("speech:transcript", handler);
    return () => ipcRenderer.removeListener("speech:transcript", handler);
  },
  onSpeechEnd: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on("speech:end", handler);
    return () => ipcRenderer.removeListener("speech:end", handler);
  },
  /** {mic} TCC status strings: granted|denied|not-determined|unknown.
   * No screen field — macOS 15+ caches that status per-process, so any
   * value here would lie for the whole session after a grant. */
  permStatus: () => ipcRenderer.invoke("perm:status"),
  /** Triggers the macOS microphone prompt; resolves true when granted. */
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  /** Opens System Settings on the given privacy pane: mic|screen|speech. */
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),

  /** Cloud desktop stays in a hardened WebContentsView owned by the main
   * process. The renderer sends only a bot id and display bounds; join URLs
   * and their rotating stream tokens never cross this bridge. */
  cloudDesktop: {
    open: (botId) => ipcRenderer.invoke("cloud-desktop:open", botId),
    reconnect: (botId) => ipcRenderer.invoke("cloud-desktop:reconnect", botId),
    setBounds: (bounds) => ipcRenderer.invoke("cloud-desktop:set-bounds", bounds),
    reload: () => ipcRenderer.invoke("cloud-desktop:reload"),
    close: () => ipcRenderer.invoke("cloud-desktop:close"),
    toggleFullscreen: () => ipcRenderer.invoke("cloud-desktop:toggle-fullscreen"),
    onState: (cb) => {
      ipcRenderer
        .invoke("cloud-desktop:get-state")
        .then((state) => cb(state))
        .catch(() => {});
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("cloud-desktop:state", handler);
      return () => ipcRenderer.removeListener("cloud-desktop:state", handler);
    },
  },

  /** In-app auto-update. State object:
   *  { status: "idle"|"checking"|"available"|"downloading"|"downloaded"|"error",
   *    version?, percent?, message? }. onState fires immediately with the
   *    current state, then on every transition. Dormant in dev (no bridge). */
  updater: {
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    onState: (cb) => {
      ipcRenderer
        .invoke("update:get-state")
        .then((s) => cb(s))
        .catch(() => {});
      const handler = (_event, s) => cb(s);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.removeListener("update:state", handler);
    },
  },
});
