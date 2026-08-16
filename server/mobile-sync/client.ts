import { EventBuffer } from "./event-buffer.ts";
import { broadcastToSyncEvent, commandToLocalRequest, type SyncCommand, type SyncEvent } from "./protocol.ts";
import { createDesktopPairing, loadDesktopSyncConfig, websocketUrl, type DesktopSyncConfig, type PairingResult } from "./pairing.ts";

export interface DesktopMobileSyncOptions {
  localBaseUrl: string;
  deviceName: string;
  snapshot: (workspaceId: string) => {
    workspaceId: string;
    bots: unknown[];
    groups: unknown[];
    messagesByThread: Record<string, unknown[]>;
    generatedAt: number;
  };
  websocketFactory?: (url: string) => WebSocket;
  fetcher?: typeof fetch;
}

export class DesktopMobileSync {
  private readonly options: DesktopMobileSyncOptions;
  private config: DesktopSyncConfig | null = loadDesktopSyncConfig();
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private online = false;
  private readonly pending = new EventBuffer<Omit<SyncEvent, "sequence">>(1_500);

  constructor(options: DesktopMobileSyncOptions) { this.options = options; }

  status() {
    return { configured: Boolean(this.config), connected: this.online, gatewayUrl: this.config?.gatewayUrl ?? null, workspaceId: this.config?.workspaceId ?? null, deviceId: this.config?.deviceId ?? null };
  }

  start(): void { this.stopped = false; if (this.config) this.connect(); }

  stop(): void {
    this.stopped = true;
    this.online = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "desktop shutdown");
    this.socket = null;
  }

  async createPairing(gatewayUrl: string): Promise<PairingResult> {
    const result = await createDesktopPairing(gatewayUrl, this.options.deviceName);
    this.config = result.config;
    this.socket?.close(1000, "new pairing");
    this.socket = null;
    this.stopped = false;
    this.connect();
    return result.pairing;
  }

  publishDesktopBroadcast(payload: unknown): void {
    if (!this.config) return;
    const event = broadcastToSyncEvent(this.config.workspaceId, payload);
    if (!event || !this.pending.push(event)) return;
    this.flush();
  }

  private connect(): void {
    if (this.stopped || !this.config || this.socket) return;
    const factory = this.options.websocketFactory ?? ((url) => new WebSocket(url));
    const socket = factory(websocketUrl(this.config.gatewayUrl));
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ kind: "hello", hello: { workspaceId: this.config!.workspaceId, deviceId: this.config!.deviceId, deviceType: "desktop", lastSequence: 0, accessToken: this.config!.accessToken } }));
    });
    socket.addEventListener("message", (message) => void this.onMessage(typeof message.data === "string" ? message.data : String(message.data)));
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.online = false;
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => { this.online = false; });
  }

  private async onMessage(raw: string): Promise<void> {
    let frame: any;
    try { frame = JSON.parse(raw); } catch { return; }
    if (frame.kind === "ready") {
      this.online = true;
      this.attempt = 0;
      this.publishSnapshot();
      this.flush();
    } else if (frame.kind === "command") {
      await this.handleCommand(frame.command as SyncCommand);
    } else if (frame.kind === "ping") {
      this.send({ kind: "pong", at: frame.at });
    } else if (frame.kind === "error" && frame.code === "unauthorized") {
      this.stopped = true;
      this.socket?.close(4401, "unauthorized");
    }
  }

  private publishSnapshot(): void {
    if (!this.config) return;
    const now = Date.now();
    this.send({ kind: "event", event: { sequence: 0, eventId: `snapshot-${now}`, workspaceId: this.config.workspaceId, type: "snapshot", payload: this.options.snapshot(this.config.workspaceId), createdAt: now } });
  }

  private flush(): void {
    if (!this.online) return;
    for (const event of this.pending.values()) this.send({ kind: "event", event: { ...event, sequence: 0 } });
    this.pending.clear();
  }

  private async handleCommand(command: SyncCommand): Promise<void> {
    try {
      const request = commandToLocalRequest(command);
      const fetcher = this.options.fetcher ?? fetch;
      const response = await fetcher(`${this.options.localBaseUrl}${request.path}`, {
        method: request.method,
        headers: request.body === undefined ? undefined : { "content-type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as any;
        throw new Error(body.error ?? `desktop returned ${response.status}`);
      }
      this.send({ kind: "command.ack", clientMutationId: command.clientMutationId, accepted: true });
    } catch (error) {
      this.send({ kind: "command.ack", clientMutationId: command.clientMutationId, accepted: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private send(frame: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.config || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }
}
