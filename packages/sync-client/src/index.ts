import { decodeFrame, encodeFrame, type ClientHello, type GatewayFrame, type SyncCommand, type SyncEvent } from "@xinyun/contracts";

export type SyncConnectionState = "idle" | "connecting" | "online" | "offline" | "closed";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (event: any) => void): void;
  removeEventListener(type: "open" | "close" | "error" | "message", listener: (event: any) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface SyncClientOptions {
  url: string;
  hello: Omit<ClientHello, "lastSequence">;
  getLastSequence: () => number;
  websocketFactory?: WebSocketFactory;
  onEvent: (event: SyncEvent) => void | Promise<void>;
  onCommand?: (command: SyncCommand) => void | Promise<void>;
  onState?: (state: SyncConnectionState) => void;
  minReconnectMs?: number;
  maxReconnectMs?: number;
}

const OPEN = 1;

export class SyncClient {
  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private state: SyncConnectionState = "idle";
  private queue: GatewayFrame[] = [];

  constructor(private readonly options: SyncClientOptions) {}

  connect(): void {
    if (this.socket || this.state === "connecting" || this.state === "online") return;
    this.manuallyClosed = false;
    this.setState("connecting");
    const factory = this.options.websocketFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    const socket = factory(this.options.url);
    this.socket = socket;

    const onOpen = () => {
      this.reconnectAttempt = 0;
      this.sendFrame({
        kind: "hello",
        hello: { ...this.options.hello, lastSequence: this.options.getLastSequence() },
      });
    };
    const onMessage = (message: { data?: unknown }) => void this.handleRawMessage(message.data);
    const onClose = () => {
      cleanup();
      if (this.socket === socket) this.socket = null;
      if (this.manuallyClosed) {
        this.setState("closed");
      } else {
        this.setState("offline");
        this.scheduleReconnect();
      }
    };
    const onError = () => {
      if (this.state !== "online") this.setState("offline");
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "client closed");
    this.setState("closed");
  }

  sendCommand(command: SyncCommand): void {
    this.enqueueOrSend({ kind: "command", command });
  }

  publishEvent(event: SyncEvent): void {
    this.enqueueOrSend({ kind: "event", event });
  }

  acknowledgeCommand(clientMutationId: string, accepted: boolean, error?: string): void {
    this.enqueueOrSend({ kind: "command.ack", clientMutationId, accepted, ...(error ? { error } : {}) });
  }

  private async handleRawMessage(raw: unknown): Promise<void> {
    try {
      const text = typeof raw === "string" ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : String(raw);
      const frame = decodeFrame(text);
      if (frame.kind === "ready") {
        this.setState("online");
        this.flushQueue();
      } else if (frame.kind === "event") {
        await this.options.onEvent(frame.event as SyncEvent);
      } else if (frame.kind === "command") {
        await this.options.onCommand?.(frame.command as SyncCommand);
      } else if (frame.kind === "ping") {
        this.sendFrame({ kind: "pong", at: frame.at });
      } else if (frame.kind === "error" && frame.code === "unauthorized") {
        this.manuallyClosed = true;
        this.socket?.close(4401, frame.message);
      }
    } catch {
      // A malformed server frame is isolated; the live connection remains usable.
    }
  }

  private enqueueOrSend(frame: GatewayFrame): void {
    if (this.state === "online" && this.socket?.readyState === OPEN) this.sendFrame(frame);
    else this.queue.push(frame);
  }

  private sendFrame(frame: GatewayFrame): void {
    if (this.socket?.readyState === OPEN) this.socket.send(encodeFrame(frame));
  }

  private flushQueue(): void {
    const queued = this.queue;
    this.queue = [];
    for (const frame of queued) this.sendFrame(frame);
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer) return;
    const min = this.options.minReconnectMs ?? 500;
    const max = this.options.maxReconnectMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.reconnectAttempt++) + Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setState(state: SyncConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
  }
}

export const createClientMutationId = (): string => `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
