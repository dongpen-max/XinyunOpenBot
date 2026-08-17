import { describe, expect, it } from "vitest";

import { mcpStdioConfigs } from "./mcp.ts";
import { parseMcpMessages } from "./mcp-http.ts";

describe("remote MCP bridge", () => {
  it("parses JSON and SSE JSON-RPC responses", () => {
    expect(parseMcpMessages('{"jsonrpc":"2.0","id":1,"result":{}}')).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
    ]);
    expect(parseMcpMessages('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n')).toEqual([
      { jsonrpc: "2.0", id: 2, result: { ok: true } },
    ]);
  });

  it("keeps remote credentials in the short-lived proxy environment", () => {
    const [config] = mcpStdioConfigs([{
      id: "feishu",
      url: "https://example.invalid/mcp",
      auth: { type: "apiKey", header: "X-App-Key", token: "secret" },
      allowedTools: ["search_docs"],
    }]);
    expect(config?.command).toBe(process.execPath);
    expect(config?.env).toMatchObject({
      XINYUN_MCP_URL: "https://example.invalid/mcp",
      XINYUN_MCP_AUTH_TOKEN: "secret",
      XINYUN_MCP_AUTH_HEADER: "X-App-Key",
      XINYUN_MCP_ALLOWED_TOOLS: '["search_docs"]',
    });
    expect(config?.args.at(-1)).toMatch(/mcp-http-proxy\.(ts|js)$/);
  });
});
