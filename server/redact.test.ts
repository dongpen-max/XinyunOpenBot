import { describe, expect, it } from "vitest";

import { redactSecrets } from "./redact.ts";

const flat = (value: unknown) => JSON.stringify(value);

describe("redactSecrets", () => {
  it("masks ACP environment credentials while preserving useful shape", () => {
    const value = {
      method: "session/new",
      params: {
        mcpServers: [
          {
            name: "agents",
            env: [
              { name: "OMB_BOT_ID", value: "bot-123" },
              { name: "OMB_COMMS_TOKEN", value: "s3cret-comms-token-value" },
            ],
          },
          {
            name: "computer",
            env: [
              { name: "OGB_BOX_ID", value: "box-9" },
              { name: "OGB_BOX_TOKEN", value: "box_live_abcdefghijklmnop" },
            ],
          },
        ],
      },
    };

    const out = flat(redactSecrets(value));
    expect(out).not.toContain("s3cret-comms-token-value");
    expect(out).not.toContain("box_live_abcdefghijklmnop");
    expect(out).toContain("OMB_COMMS_TOKEN");
    expect(out).toContain("OGB_BOX_TOKEN");
    expect(out).toContain("bot-123");
    expect(out).toContain("box-9");
  });

  it("masks MCP headers and object-form environment credentials", () => {
    const value = {
      mcpServers: {
        composio: { headers: { "x-consumer-api-key": "ck_live_supersecret" } },
        computer: { env: { ELECTRON_RUN_AS_NODE: "1", OGB_BOX_TOKEN: "box_live_zzz" } },
      },
    };

    const out = flat(redactSecrets(value));
    expect(out).not.toContain("ck_live_supersecret");
    expect(out).not.toContain("box_live_zzz");
    expect(out).toContain("ELECTRON_RUN_AS_NODE");
  });

  it("does not mangle ordinary protocol data", () => {
    const value = { keyboard: "cmd+k", monkey: "business", hotkey: "ctrl", text: "the key to this bug" };
    expect(redactSecrets(value)).toEqual(value);
  });

  it("bounds recursion and accepts non-objects", () => {
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(null)).toBe(null);
    let deep: Record<string, unknown> = { token: "deep-secret" };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});
