import { describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";
import { mcpStdioConfigs, publicMcpServers, recordMcpProbe, upsertMcpServer } from "./mcp.ts";
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

  it("preserves an explicit empty allowlist so every remote tool is disabled", () => {
    const [config] = mcpStdioConfigs([{
      id: "feishu",
      url: "https://example.invalid/mcp",
      allowedTools: [],
    }]);
    expect(config?.env?.XINYUN_MCP_ALLOWED_TOOLS).toBe("[]");
  });

  it("publishes discovered tools without credentials and persists tool selection", () => {
    const cfg: AppConfig = {
      mcp: {
        servers: {
          feishu: {
            name: "飞书",
            url: "https://example.invalid/mcp",
            auth: { type: "bearer", token: "secret" },
          },
        },
      },
    };
    const discovered = recordMcpProbe(cfg, "feishu", {
      status: "ok",
      tools: [
        { name: "search_docs", description: "Search docs" },
        { name: "write_docs", description: "Write docs" },
      ],
    });
    expect(discovered).not.toBeNull();
    cfg.mcp!.servers = discovered!;
    const selected = upsertMcpServer(cfg, { id: "feishu", allowedTools: ["search_docs", "unknown_tool"] });
    cfg.mcp!.servers = selected.servers;

    const [server] = publicMcpServers(cfg);
    expect(server).toMatchObject({
      id: "feishu",
      authConfigured: true,
      allowedTools: ["search_docs"],
      health: "online",
    });
    expect(server?.tools).toEqual([
      { name: "search_docs", description: "Search docs", allowed: true },
      { name: "write_docs", description: "Write docs", allowed: false },
    ]);
    expect(JSON.stringify(server)).not.toContain("secret");
  });
});
