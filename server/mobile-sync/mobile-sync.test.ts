import { describe, expect, it } from "vitest";
import { EventBuffer } from "./event-buffer.ts";
import { broadcastToSyncEvent, commandToLocalRequest } from "./protocol.ts";

describe("desktop mobile sync", () => {
  it("maps desktop broadcasts to protocol events", () => {
    const event = broadcastToSyncEvent("workspace", { kind: "message", threadId: "thread", message: { id: "m1" } });
    expect(event).toMatchObject({ workspaceId: "workspace", type: "message.added", payload: { threadId: "thread", message: { id: "m1" } } });
  });

  it("maps commands to existing loopback routes", () => {
    expect(commandToLocalRequest({ clientMutationId: "mutation-1", type: "group.turn.interrupt", payload: { groupId: "g1" } })).toEqual({ path: "/api/groups/g1/interrupt", method: "POST" });
  });

  it("bounds and deduplicates buffered events", () => {
    const buffer = new EventBuffer<{ eventId: string }>(2);
    expect(buffer.push({ eventId: "1" })).toBe(true);
    expect(buffer.push({ eventId: "1" })).toBe(false);
    buffer.push({ eventId: "2" }); buffer.push({ eventId: "3" });
    expect(buffer.values().map((event) => event.eventId)).toEqual(["2", "3"]);
  });
});
