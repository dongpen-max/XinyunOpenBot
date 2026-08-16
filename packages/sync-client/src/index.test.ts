import { describe, expect, it, vi } from "vitest";
import { SyncClient, type WebSocketLike } from "./index.ts";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, Set<(event: any) => void>>();
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: any) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

describe("SyncClient", () => {
  it("sends hello and becomes online after ready", async () => {
    const socket = new FakeSocket();
    const states: string[] = [];
    const client = new SyncClient({
      url: "ws://example/v1/sync",
      hello: { workspaceId: "ws", deviceId: "ios", deviceType: "ios", accessToken: "0123456789abcdef" },
      getLastSequence: () => 7,
      websocketFactory: () => socket,
      onEvent: vi.fn(),
      onState: (state) => states.push(state),
    });
    client.connect();
    socket.readyState = 1;
    socket.emit("open", {});
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ kind: "hello", hello: { lastSequence: 7 } });
    socket.emit("message", { data: JSON.stringify({ kind: "ready", latestSequence: 7 }) });
    await Promise.resolve();
    expect(states).toContain("online");
    client.close();
  });
});
