import { describe, expect, it } from "vitest";
import { clientHelloSchema, decodeFrame, syncCommandSchema } from "./index.ts";

describe("sync contracts", () => {
  it("accepts a valid hello", () => {
    expect(clientHelloSchema.parse({
      workspaceId: "ws-1",
      deviceId: "dev-1",
      deviceType: "ios",
      lastSequence: 0,
      accessToken: "0123456789abcdef",
    }).deviceType).toBe("ios");
  });

  it("rejects underspecified commands", () => {
    expect(() => syncCommandSchema.parse({ type: "message.send", payload: {} })).toThrow();
  });

  it("decodes websocket frames", () => {
    expect(decodeFrame(JSON.stringify({ kind: "ping", at: 1 }))).toEqual({ kind: "ping", at: 1 });
  });
});
