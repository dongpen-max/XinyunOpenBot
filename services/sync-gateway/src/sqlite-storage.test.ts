import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteGatewayStorage } from "./sqlite-storage.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("SqliteGatewayStorage", () => {
  it("persists replay events, commands and push tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "xinyun-gateway-")); dirs.push(dir);
    const file = join(dir, "gateway.sqlite");
    const storage = new SqliteGatewayStorage(file);
    storage.createPairing({ pairingId: "pair", code: "ABCDEF12", workspaceId: "ws", desktopDeviceId: "desktop", expiresAt: Date.now() + 1_000 }, { workspaceId: "ws", deviceId: "desktop", deviceType: "desktop", name: "PC", tokenHash: "hash", createdAt: Date.now() });
    storage.savePushToken("ws", "desktop", "ExponentPushToken[test]");
    const event = storage.appendEvent({ eventId: "ev", workspaceId: "ws", type: "snapshot", payload: { bots: [] }, createdAt: Date.now() });
    expect(event.sequence).toBe(1);
    expect(storage.eventsAfter("ws", 0)).toHaveLength(1);
    expect(storage.pushTokens("ws")).toEqual(["ExponentPushToken[test]"]);
    expect(storage.insertCommand("ws", { clientMutationId: "mutation-1", type: "turn.interrupt", payload: { botId: "b" } }, Date.now())).toBe(true);
    expect(storage.insertCommand("ws", { clientMutationId: "mutation-1", type: "turn.interrupt", payload: { botId: "b" } }, Date.now())).toBe(false);
    storage.close();
    const reopened = new SqliteGatewayStorage(file);
    expect(reopened.latestSequence("ws")).toBe(1);
    expect(reopened.pendingCommands("ws")).toHaveLength(1);
    reopened.close();
  });
});
