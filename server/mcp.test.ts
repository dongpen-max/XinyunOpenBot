import { describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";
import { autoDecision } from "./auto-approve.ts";
import { activeMcpIntegrations, autoApprovedMcpTools, exportMcpConfig, importMcpConfig, managedMcpToolRequiresHuman, mcpStdioConfigs, publicMcpServers, recordMcpProbe, safeMcpError, upsertMcpServer } from "./mcp.ts";
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
      { name: "search_docs", description: "Search docs", allowed: true, policy: "auto" },
      { name: "write_docs", description: "Write docs", allowed: false, policy: "deny" },
    ]);
    expect(JSON.stringify(server)).not.toContain("secret");
  });

  it("defaults mutating tools to ask and only pre-approves auto tools", () => {
    const cfg: AppConfig = {
      mcp: {
        servers: {
          feishu: { name: "飞书", url: "https://example.invalid/mcp" },
        },
      },
    };
    cfg.mcp!.servers = recordMcpProbe(cfg, "feishu", {
      status: "ok",
      tools: [{ name: "search_docs" }, { name: "create_document" }, { name: "delete_document" }],
    })!;
    const [server] = publicMcpServers(cfg);
    expect(server.tools.map((tool) => [tool.name, tool.policy])).toEqual([
      ["search_docs", "auto"],
      ["create_document", "ask"],
      ["delete_document", "ask"],
    ]);
    expect(autoApprovedMcpTools({
      id: "feishu",
      url: "https://example.invalid/mcp",
      allowedTools: server.allowedTools ?? undefined,
      toolPolicies: Object.fromEntries(server.tools.map((tool) => [tool.name, tool.policy])),
    })).toEqual(["mcp__feishu__search_docs"]);
  });

  it("scopes services per bot while keeping absent scope compatible with all bots", () => {
    const cfg: AppConfig = { mcp: { servers: {
      global: { name: "Global", url: "https://global.invalid/mcp" },
      scoped: { name: "Scoped", url: "https://scoped.invalid/mcp", botIds: ["bot-a"] },
      nobody: { name: "Nobody", url: "https://none.invalid/mcp", botIds: [] },
    } } };
    expect(activeMcpIntegrations(cfg, "bot-a").map((server) => server.id)).toEqual(["global", "scoped"]);
    expect(activeMcpIntegrations(cfg, "bot-b").map((server) => server.id)).toEqual(["global"]);
  });

  it("keeps managed ask tools human-gated while auto tools follow normal auto mode", () => {
    const cfg: AppConfig = {
      mcp: {
        servers: {
          configured: {
            name: "Configured",
            url: "https://example.invalid/mcp",
            tools: [{ name: "search_docs" }, { name: "write.docs" }],
            toolPolicies: { search_docs: "auto", "write.docs": "ask" },
          },
        },
      },
    };
    expect(managedMcpToolRequiresHuman(cfg, "mcp__configured__write.docs", "resolved")).toBe(true);
    expect(managedMcpToolRequiresHuman(cfg, "mcp__configured__search_docs", "resolved")).toBe(false);
    expect(autoDecision({ autoApprove: true }, "mcp__configured__search_docs", "search docs")).toBe(
      "auto-approved mcp__configured__search_docs",
    );
  });

  it("fails closed for ambiguous sanitized MCP names instead of auto-approving them", () => {
    const cfg: AppConfig = {
      mcp: {
        servers: {
          configured: {
            name: "Configured",
            url: "https://example.invalid/mcp",
            tools: [{ name: "write.docs" }, { name: "write_docs" }],
            toolPolicies: { "write.docs": "auto", write_docs: "auto" },
          },
        },
      },
    };
    expect(managedMcpToolRequiresHuman(cfg, "configured_write_docs", "ambiguous")).toBe(true);
  });

  it("keeps denied MCP tools out of the attached proxy allowlist", () => {
    const cfg: AppConfig = {
      mcp: {
        servers: {
          configured: {
            name: "Configured",
            url: "https://example.invalid/mcp",
            tools: [{ name: "search_docs" }, { name: "delete_docs" }],
            toolPolicies: { search_docs: "auto", delete_docs: "deny" },
          },
        },
      },
    };
    const [integration] = activeMcpIntegrations(cfg, "bot-a");
    expect(integration?.allowedTools).toEqual(["search_docs"]);
    expect(JSON.parse(mcpStdioConfigs([integration!])[0]!.env!.XINYUN_MCP_ALLOWED_TOOLS!)).toEqual(["search_docs"]);
  });

  it("exports no credentials and imports by bot name while preserving local tokens", () => {
    const cfg: AppConfig = { mcp: { servers: { feishu: {
      name: "飞书",
      url: "https://example.invalid/mcp?region=cn&token=url-secret",
      enabled: true,
      botIds: ["bot-a"],
      auth: { type: "apiKey", header: "X-App-Key", token: "local-secret" },
      toolPolicies: { search_docs: "auto" },
    } } } };
    const bundle = exportMcpConfig(cfg, new Map([["bot-a", "研究员"]]));
    expect(bundle.servers[0]).toMatchObject({ id: "feishu", botNames: ["研究员"], authType: "apiKey" });
    expect(JSON.stringify(bundle)).not.toContain("local-secret");
    expect(JSON.stringify(bundle)).not.toContain("url-secret");
    expect(bundle.servers[0]?.url).toContain("region=cn");

    const imported = importMcpConfig(cfg, bundle, new Map([["研究员", "bot-b"]]));
    expect(imported.servers.feishu).toMatchObject({ botIds: ["bot-b"], auth: { token: "local-secret" } });
  });

  it("redacts connection errors before persistence or display", () => {
    const credential = "a".repeat(40);
    const message = safeMcpError(`HTTP 401 Bearer ${credential} token=top-secret`);
    expect(message).not.toContain(credential);
    expect(message).not.toContain("top-secret");
  });
});
