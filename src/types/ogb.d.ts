// The narrow bridge the Electron preload exposes. Absent in the browser.
export {};

declare global {
  interface Window {
    ogb?: {
      platform: string;
      getPathForFile?(file: File): string;
      setTitleBarColor?(color: string): Promise<void>;
      screenFrame(): Promise<string | null>;
      speechStart(): Promise<void>;
      speechStop(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null }) => void): () => void;
      /** {mic} TCC status: granted|denied|not-determined|unknown. Screen
       * status is deliberately absent — macOS 15+ caches it per-process,
       * so it lies for the whole session after a grant. */
      permStatus(): Promise<{ mic: string }>;
      /** Triggers the macOS microphone prompt; resolves true when granted. */
      permRequestMic(): Promise<boolean>;
      /** Opens System Settings on a privacy pane: mic|screen|speech. */
      permOpenSettings(pane: "mic" | "screen" | "speech"): Promise<void>;
      cloudDesktop?: {
        open(botId: string): Promise<{ ok: boolean }>;
        reconnect(botId: string): Promise<{ ok: boolean }>;
        openInBrowser(botId: string): Promise<{ ok: boolean }>;
        setBounds(bounds: CloudDesktopBounds): Promise<void>;
        reload(): Promise<void>;
        focus(): Promise<boolean>;
        paste(): Promise<boolean>;
        close(): Promise<void>;
        toggleFullscreen(): Promise<boolean>;
        onState(cb: (state: CloudDesktopState) => void): () => void;
      };
      /** In-app auto-update (packaged app only; dormant in dev). onState
       * fires immediately with the current state, then on transitions. */
      updater?: {
        check(): Promise<void>;
        download(): Promise<void>;
        /** quit-and-install the downloaded update */
        install(): Promise<void>;
        onState(cb: (s: UpdaterState) => void): () => void;
      };
    };
  }
}

export interface UpdaterState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  message?: string;
}

export interface CloudDesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CloudDesktopState {
  state: "connecting" | "ready" | "reconnecting" | "failed" | "closed";
  botId: string | null;
  message?: string;
  fullscreen: boolean;
}
