import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { clientHelloSchema, decodeFrame, encodeFrame, syncCommandSchema, syncEventSchema, type ClientHello, type GatewayFrame, type SyncCommand, type SyncEvent } from "@xinyun/contracts";
import { MemoryGatewayStorage } from "./memory-storage.ts";
import type { GatewayStorage } from "./storage.ts";
import { ExpoPushNotifier, type PushNotifier } from "./push.ts";

export interface GatewayServerOptions {
  host?: string;
  port?: number;
  publicUrl?: string;
  storage?: GatewayStorage;
  heartbeatMs?: number;
  requestLimitPerMinute?: number;
  pushNotifier?: PushNotifier;
}

interface Session { socket: WebSocket; hello: ClientHello; alive: boolean; }

const json = (res: ServerResponse, status: number, payload: unknown) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
};

const readJson = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 256_000) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

const token = () => randomBytes(32).toString("base64url");
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenMatches = (value: string, expectedHash: string) => {
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export function createGatewayServer(options: GatewayServerOptions = {}) {
  const storage = options.storage ?? new MemoryGatewayStorage();
  const sessions = new Set<Session>();
  const rate = new Map<string, { minute: number; count: number }>();
  const requestLimit = options.requestLimitPerMinute ?? 120;
  const pushNotifier = options.pushNotifier ?? new ExpoPushNotifier();

  const authenticate = (req: IncomingMessage, workspaceId?: string) => {
    const authorization = req.headers.authorization;
    const deviceId = String(req.headers["x-device-id"] ?? "");
    const candidate = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!workspaceId || !deviceId || !candidate) return undefined;
    const device = storage.device(workspaceId, deviceId);
    return device && !device.revokedAt && tokenMatches(candidate, device.tokenHash) ? device : undefined;
  };

  const send = (socket: WebSocket, frame: GatewayFrame) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeFrame(frame));
  };

  const broadcastWorkspace = (workspaceId: string, frame: GatewayFrame, deviceType?: ClientHello["deviceType"]) => {
    for (const session of sessions) if (session.hello.workspaceId === workspaceId && (!deviceType || session.hello.deviceType === deviceType)) send(session.socket, frame);
  };

  const relayCommand = (workspaceId: string, command: SyncCommand) => {
    broadcastWorkspace(workspaceId, { kind: "command", command }, "desktop");
  };

  const server = createServer(async (req, res) => {
    try {
      const ip = req.socket.remoteAddress ?? "unknown";
      const minute = Math.floor(Date.now() / 60_000);
      const bucket = rate.get(ip);
      const next = !bucket || bucket.minute !== minute ? { minute, count: 1 } : { minute, count: bucket.count + 1 };
      rate.set(ip, next);
      if (next.count > requestLimit) return json(res, 429, { error: "rate limit exceeded" });

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, sessions: sessions.size, now: Date.now() });

      if (req.method === "POST" && path === "/v1/pairings") {
        const body = await readJson(req);
        const now = Date.now();
        const workspaceId = typeof body.workspaceId === "string" && body.workspaceId ? body.workspaceId : `ws-${randomUUID()}`;
        const desktopDeviceId = `desktop-${randomUUID()}`;
        const desktopAccessToken = token();
        const pairing = {
          pairingId: `pair-${randomUUID()}`,
          code: randomBytes(4).toString("hex").toUpperCase(),
          workspaceId,
          desktopDeviceId,
          expiresAt: now + 10 * 60_000,
        };
        storage.createPairing(pairing, { workspaceId, deviceId: desktopDeviceId, deviceType: "desktop", name: String(body.deviceName ?? "XinyunOpen Bot PC"), tokenHash: hashToken(desktopAccessToken), createdAt: now });
        return json(res, 201, { ...pairing, desktopAccessToken });
      }

      if (req.method === "POST" && path === "/v1/pairings/claim") {
        const body = await readJson(req);
        const code = String(body.code ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
        const pairing = storage.pairingByCode(code);
        if (!pairing || pairing.expiresAt < Date.now() || pairing.claimedAt) return json(res, 404, { error: "配对码无效或已过期" });
        const accessToken = token();
        const deviceId = `ios-${randomUUID()}`;
        const claimed = storage.claimPairing(pairing.pairingId, { workspaceId: pairing.workspaceId, deviceId, deviceType: "ios", name: String(body.deviceName ?? "iPhone"), tokenHash: hashToken(accessToken), createdAt: Date.now() }, Date.now());
        if (!claimed) return json(res, 409, { error: "配对码已被使用" });
        return json(res, 200, { workspaceId: pairing.workspaceId, deviceId, accessToken, gatewayUrl: options.publicUrl ?? `http://${req.headers.host}` });
      }

      if (req.method === "GET" && path === "/v1/snapshot") {
        const workspaceId = String(url.searchParams.get("workspaceId") ?? "");
        if (!authenticate(req, workspaceId)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { snapshot: storage.latestSnapshot(workspaceId)?.payload ?? null, latestSequence: storage.latestSequence(workspaceId) });
      }

      if (req.method === "POST" && path === "/v1/commands") {
        const body = await readJson(req);
        const workspaceId = String(body.workspaceId ?? "");
        if (!authenticate(req, workspaceId)) return json(res, 401, { error: "unauthorized" });
        const command = syncCommandSchema.parse(body.command) as SyncCommand;
        const inserted = storage.insertCommand(workspaceId, command, Date.now());
        if (inserted) relayCommand(workspaceId, command);
        return json(res, inserted ? 202 : 200, { accepted: true, duplicate: !inserted });
      }

      if (req.method === "POST" && path === "/v1/devices/push-token") {
        const body = await readJson(req);
        const workspaceId = String(body.workspaceId ?? "");
        const device = authenticate(req, workspaceId);
        if (!device) return json(res, 401, { error: "unauthorized" });
        const pushToken = String(body.pushToken ?? "");
        if (!pushToken) return json(res, 400, { error: "pushToken required" });
        storage.savePushToken(workspaceId, device.deviceId, pushToken);
        return json(res, 204, null);
      }

      const deviceMatch = path.match(/^\/v1\/devices\/([\w-]+)$/);
      if (req.method === "DELETE" && deviceMatch) {
        const workspaceId = String(url.searchParams.get("workspaceId") ?? "");
        if (!authenticate(req, workspaceId)) return json(res, 401, { error: "unauthorized" });
        if (!storage.revokeDevice(workspaceId, deviceMatch[1]!, Date.now())) return json(res, 404, { error: "device not found" });
        for (const session of [...sessions]) if (session.hello.workspaceId === workspaceId && session.hello.deviceId === deviceMatch[1]) session.socket.close(4401, "device revoked");
        return json(res, 204, null);
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as any).status) : 400;
      json(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 512_000 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/v1/sync") { socket.destroy(); return; }
    websocketServer.handleUpgrade(req, socket, head, (ws) => websocketServer.emit("connection", ws, req));
  });

  websocketServer.on("connection", (socket) => {
    let session: Session | undefined;
    const authTimer = setTimeout(() => socket.close(4401, "hello timeout"), 5_000);
    socket.on("pong", () => { if (session) session.alive = true; });
    socket.on("message", (data) => {
      try {
        const frame = decodeFrame(data.toString());
        if (!session) {
          if (frame.kind !== "hello") throw new Error("hello required");
          const hello = clientHelloSchema.parse(frame.hello);
          const device = storage.device(hello.workspaceId, hello.deviceId);
          if (!device || device.revokedAt || device.deviceType !== hello.deviceType || !tokenMatches(hello.accessToken, device.tokenHash)) {
            send(socket, { kind: "error", code: "unauthorized", message: "invalid device credentials" });
            socket.close(4401, "unauthorized");
            return;
          }
          clearTimeout(authTimer);
          session = { socket, hello, alive: true };
          sessions.add(session);
          for (const event of storage.eventsAfter(hello.workspaceId, hello.lastSequence)) send(socket, { kind: "event", event });
          if (hello.deviceType === "desktop") for (const pending of storage.pendingCommands(hello.workspaceId)) send(socket, { kind: "command", command: pending.command });
          send(socket, { kind: "ready", latestSequence: storage.latestSequence(hello.workspaceId) });
          return;
        }

        if (frame.kind === "pong") { session.alive = true; return; }
        if (frame.kind === "event" && session.hello.deviceType === "desktop") {
          const incoming = syncEventSchema.parse(frame.event) as SyncEvent;
          if (incoming.workspaceId !== session.hello.workspaceId) throw new Error("workspace mismatch");
          const event = storage.appendEvent({ eventId: incoming.eventId, workspaceId: incoming.workspaceId, type: incoming.type, payload: incoming.payload, createdAt: incoming.createdAt });
          broadcastWorkspace(event.workspaceId, { kind: "event", event }, "ios");
          if (event.type === "turn.completed") {
            const threadId = String((event.payload as { threadId?: string })?.threadId ?? "") || undefined;
            void pushNotifier.notifyTaskCompleted(storage.pushTokens(event.workspaceId), { workspaceId: event.workspaceId, threadId }).catch(() => {});
          }
        } else if (frame.kind === "command" && session.hello.deviceType === "ios") {
          const command = syncCommandSchema.parse(frame.command) as SyncCommand;
          const inserted = storage.insertCommand(session.hello.workspaceId, command, Date.now());
          if (inserted) relayCommand(session.hello.workspaceId, command);
          send(socket, { kind: "command.ack", clientMutationId: command.clientMutationId, accepted: true });
        } else if (frame.kind === "command.ack" && session.hello.deviceType === "desktop") {
          storage.completeCommand(session.hello.workspaceId, frame.clientMutationId, frame.accepted, frame.error);
          broadcastWorkspace(session.hello.workspaceId, frame, "ios");
        }
      } catch (error) {
        send(socket, { kind: "error", code: "bad_frame", message: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.on("close", () => { clearTimeout(authTimer); if (session) sessions.delete(session); });
  });

  const heartbeat = setInterval(() => {
    for (const session of [...sessions]) {
      if (!session.alive) { session.socket.terminate(); sessions.delete(session); continue; }
      session.alive = false;
      session.socket.ping();
      send(session.socket, { kind: "ping", at: Date.now() });
    }
  }, options.heartbeatMs ?? 25_000);

  return {
    server,
    storage,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 8788, options.host ?? "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      return server.address();
    },
    async close() {
      clearInterval(heartbeat);
      for (const session of sessions) session.socket.terminate();
      sessions.clear();
      websocketServer.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      storage.close();
    },
  };
}
