import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGatewayServer } from "./server.ts";

const running: Array<ReturnType<typeof createGatewayServer>> = [];
afterEach(async () => { while (running.length) await running.pop()!.close(); });

const openSocket = (url: string) => new Promise<WebSocket>((resolve, reject) => {
  const socket = new WebSocket(url);
  socket.once("open", () => resolve(socket));
  socket.once("error", reject);
});
const nextFrame = (socket: WebSocket) => new Promise<any>((resolve) => socket.once("message", (data) => resolve(JSON.parse(data.toString()))));
const nextFrames = (socket: WebSocket, count: number) => new Promise<any[]>((resolve) => {
  const frames: any[] = [];
  const onMessage = (data: WebSocket.RawData) => {
    frames.push(JSON.parse(data.toString()));
    if (frames.length === count) { socket.off("message", onMessage); resolve(frames); }
  };
  socket.on("message", onMessage);
});

describe("sync gateway", () => {
  it("pairs devices, relays events and replays missed events", async () => {
    const gateway = createGatewayServer({ port: 0, heartbeatMs: 60_000 });
    running.push(gateway);
    const address = await gateway.listen() as import("node:net").AddressInfo;
    const http = `http://127.0.0.1:${address.port}`;
    const ws = `ws://127.0.0.1:${address.port}/v1/sync`;

    const pairing = await fetch(`${http}/v1/pairings`, { method: "POST", body: JSON.stringify({ deviceName: "PC" }) }).then((response) => response.json()) as any;
    const claim = await fetch(`${http}/v1/pairings/claim`, { method: "POST", body: JSON.stringify({ code: pairing.code, deviceName: "iPhone" }) }).then((response) => response.json()) as any;
    expect(claim.workspaceId).toBe(pairing.workspaceId);

    const desktop = await openSocket(ws);
    desktop.send(JSON.stringify({ kind: "hello", hello: { workspaceId: pairing.workspaceId, deviceId: pairing.desktopDeviceId, deviceType: "desktop", lastSequence: 0, accessToken: pairing.desktopAccessToken } }));
    expect((await nextFrame(desktop)).kind).toBe("ready");
    const mobile = await openSocket(ws);
    mobile.send(JSON.stringify({ kind: "hello", hello: { workspaceId: claim.workspaceId, deviceId: claim.deviceId, deviceType: "ios", lastSequence: 0, accessToken: claim.accessToken } }));
    expect((await nextFrame(mobile)).kind).toBe("ready");

    const eventPromise = nextFrame(mobile);
    desktop.send(JSON.stringify({ kind: "event", event: { sequence: 0, eventId: "event-1", workspaceId: pairing.workspaceId, type: "turn.delta", payload: { text: "你" }, createdAt: Date.now() } }));
    const relayed = await eventPromise;
    expect(relayed.event).toMatchObject({ sequence: 1, type: "turn.delta", payload: { text: "你" } });
    mobile.close();

    const replay = await openSocket(ws);
    const replayFrames = nextFrames(replay, 2);
    replay.send(JSON.stringify({ kind: "hello", hello: { workspaceId: claim.workspaceId, deviceId: claim.deviceId, deviceType: "ios", lastSequence: 0, accessToken: claim.accessToken } }));
    const [missed, ready] = await replayFrames;
    expect(missed.event.sequence).toBe(1);
    expect(ready.kind).toBe("ready");
    desktop.close(); replay.close();
  });

  it("deduplicates commands by clientMutationId", async () => {
    const gateway = createGatewayServer({ port: 0 }); running.push(gateway);
    const address = await gateway.listen() as import("node:net").AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const pairing = await fetch(`${base}/v1/pairings`, { method: "POST", body: "{}" }).then((r) => r.json()) as any;
    const command = { clientMutationId: "mutation-123", type: "message.send", payload: { botId: "b", text: "hi" } };
    const headers = { authorization: `Bearer ${pairing.desktopAccessToken}`, "x-device-id": pairing.desktopDeviceId, "content-type": "application/json" };
    const first = await fetch(`${base}/v1/commands`, { method: "POST", headers, body: JSON.stringify({ workspaceId: pairing.workspaceId, command }) });
    const second = await fetch(`${base}/v1/commands`, { method: "POST", headers, body: JSON.stringify({ workspaceId: pairing.workspaceId, command }) });
    expect(first.status).toBe(202);
    expect(await second.json()).toMatchObject({ accepted: true, duplicate: true });
  });
});
