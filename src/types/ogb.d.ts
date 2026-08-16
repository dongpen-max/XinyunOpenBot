// The narrow bridge the Electron preload exposes. Absent in the browser.
export {};

declare global {
  type DesktopCapabilities = {
    host: { platform: "darwin" | "linux" | "win32" | "other"; packaged: boolean };
    windowChrome: "mac-inset" | "native";
    screenPreview: { available: boolean; reasonCode?: string };
    dictation: { available: boolean; engine: "apple-speech" | "none"; reasonCode?: string };
    localComputer: { available: boolean; reasonCode?: string };
  };

  interface Window {
    ogb?: {
      platform: NodeJS.Platform;
      getCapabilities(): Promise<DesktopCapabilities>;
      setTitleBarColor?(color: string): Promise<void>;
      screenFrame(): Promise<string | null>;
      speechStart(options?: { endpointMs?: number }): Promise<void>;
      speechStop(): Promise<void>;
      speechFinish(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null; reason?: string }) => void): () => void;
      /** {mic} TCC status: granted|denied|not-determined|unknown. Screen
       * status is deliberately absent — macOS 15+ caches it per-process,
       * so it lies for the whole session after a grant. */
      permStatus(): Promise<{ mic: string }>;
      /** Triggers the macOS microphone prompt; resolves true when granted. */
      permRequestMic(): Promise<boolean>;
      /** Opens System Settings on a privacy pane: mic|screen|speech. */
      permOpenSettings(pane: "mic" | "screen" | "speech"): Promise<void>;
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
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "disabled" | "error";
  version?: string;
  percent?: number;
  message?: string;
}
