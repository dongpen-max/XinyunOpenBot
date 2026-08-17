import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig, McpServerConfig } from "./config.ts";
import { closeRemoteMcp, requestRemoteMcp } from "./mcp-http.ts";
import type { McpStdioConfig } from "./tools/mcp-stdio.ts";

export interface McpIntegration {
  id: string;
  url: string;
  auth?: McpServerConfig["auth"];
  allowedTools?: string[];
}

export interface PublicMcpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authConfigured: boolean;
  authType: "bearer" | "apiKey" | null;
  /** null means all advertised tools; [] means no tools. */
  allowedTools: string[] | null;
  tools: Array<{ name: string; description: string; allowed: boolean }>;
  lastCheckedAt: string | null;
  health: "unknown" | "online" | "error";
}

const validId = /^[a-z][a-z0-9_-]{0,31}$/;
const validHeader = /^[A-Za-z0-9-]{1,64}$/;
const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const reservedIds = new Set(["agents", "computer", "composio", "ogb"]);

function normalizedId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const fromName = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return validId.test(fromName) ? fromName : "mcp-server";
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("MCP 服务地址不能为空");
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("MCP 服务地址不是有效 URL");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback.has(parsed.hostname))) {
    throw new Error("MCP 服务仅允许 HTTPS，或本机 loopback HTTP 地址");
  }
  return parsed.toString();
}

export function publicMcpServers(cfg: AppConfig): PublicMcpServer[] {
  return Object.entries(cfg.mcp?.servers ?? {})
    .filter(([id, server]) => validId.test(id) && Boolean(server?.url))
    .map(([id, server]) => {
      const allowed = server.allowedTools ? new Set(server.allowedTools) : null;
      return {
        id,
        name: server.name || id,
        url: server.url,
        enabled: server.enabled !== false,
        authConfigured: Boolean(server.auth?.token),
        authType: server.auth?.type ?? null,
        allowedTools: server.allowedTools ?? null,
        tools: (server.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          allowed: allowed ? allowed.has(tool.name) : true,
        })),
        lastCheckedAt: server.lastCheckedAt ?? null,
        health: server.lastCheckStatus === "ok" ? "online" as const : server.lastCheckStatus === "error" ? "error" as const : "unknown" as const,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function activeMcpIntegrations(cfg: AppConfig): McpIntegration[] {
  return Object.entries(cfg.mcp?.servers ?? {})
    .filter(([id, server]) => validId.test(id) && server.enabled !== false && Boolean(server.url))
    .map(([id, server]) => ({ id, url: server.url, auth: server.auth, allowedTools: server.allowedTools }));
}

export function upsertMcpServer(
  cfg: AppConfig,
  input: Record<string, unknown>,
): { id: string; servers: Record<string, McpServerConfig> } {
  let id = normalizedId(input.id ?? input.name);
  if (input.id === undefined) {
    let suffix = 2;
    const base = id;
    while (cfg.mcp?.servers?.[id]) id = `${base.slice(0, 30 - String(suffix).length)}-${suffix++}`;
  }
  if (reservedIds.has(id)) throw new Error(`MCP 服务 ID “${id}” 与内置工具冲突`);
  const current = cfg.mcp?.servers?.[id];
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : current?.name || id;
  const url = input.url === undefined ? current?.url : validateUrl(input.url);
  if (!url) throw new Error("MCP 服务地址不能为空");
  const enabled = input.enabled === undefined ? current?.enabled !== false : input.enabled === true;
  const knownTools = new Set((current?.tools ?? []).map((tool) => tool.name));
  const allowedTools = Array.isArray(input.allowedTools)
    ? [...new Set(input.allowedTools
      .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
      .map((name) => name.trim())
      .filter((name) => !knownTools.size || knownTools.has(name)))].slice(0, 100)
    : current?.allowedTools;
  const clearAuth = input.authType === "none";
  const type = clearAuth ? undefined : input.authType === "bearer" || input.authType === "apiKey" ? input.authType : current?.auth?.type;
  const header = typeof input.authHeader === "string" && input.authHeader.trim() ? input.authHeader.trim() : current?.auth?.header;
  if (type === "apiKey" && header && !validHeader.test(header)) throw new Error("API Key 请求头名称无效");
  const token = clearAuth ? undefined : typeof input.token === "string" && input.token.trim() ? input.token.trim() : current?.auth?.token;
  const auth = type && token ? { type, ...(type === "apiKey" && header ? { header } : {}), token } : undefined;
  const servers = {
    ...(cfg.mcp?.servers ?? {}),
    [id]: {
      name,
      url,
      enabled,
      ...(auth ? { auth } : {}),
      ...(allowedTools !== undefined ? { allowedTools } : {}),
      ...(current?.tools ? { tools: current.tools } : {}),
      ...(current?.lastCheckedAt ? { lastCheckedAt: current.lastCheckedAt } : {}),
      ...(current?.lastCheckStatus ? { lastCheckStatus: current.lastCheckStatus } : {}),
    },
  };
  return { id, servers };
}

function normalizedTools(tools: Array<{ name: string; description?: string }>): Array<{ name: string; description?: string }> {
  const seen = new Set<string>();
  return tools.flatMap((tool) => {
    const name = typeof tool?.name === "string" ? tool.name.trim().slice(0, 160) : "";
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const description = typeof tool.description === "string" ? tool.description.trim().slice(0, 800) : "";
    return [{ name, ...(description ? { description } : {}) }];
  }).slice(0, 200);
}

export function recordMcpProbe(
  cfg: AppConfig,
  id: string,
  result: { status: "ok"; tools: Array<{ name: string; description?: string }> } | { status: "error" },
): Record<string, McpServerConfig> | null {
  const current = cfg.mcp?.servers?.[id];
  if (!current || !validId.test(id)) return null;
  const next: McpServerConfig = {
    ...current,
    lastCheckedAt: new Date().toISOString(),
    lastCheckStatus: result.status,
  };
  if (result.status === "ok") {
    next.tools = normalizedTools(result.tools);
    if (next.allowedTools !== undefined) {
      const known = new Set(next.tools.map((tool) => tool.name));
      next.allowedTools = next.allowedTools.filter((name) => known.has(name));
    }
  }
  return { ...(cfg.mcp?.servers ?? {}), [id]: next };
}

export function deleteMcpServer(cfg: AppConfig, id: string): Record<string, McpServerConfig> | null {
  if (!validId.test(id) || !cfg.mcp?.servers?.[id]) return null;
  const servers = { ...cfg.mcp.servers };
  delete servers[id];
  return servers;
}

export async function probeMcpServer(server: McpServerConfig): Promise<Array<{ name: string; description: string }>> {
  let session = {};
  try {
    const initialized = await requestRemoteMcp(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "xinyunopen-bot", version: "0.1.31" } },
    }, session);
    session = initialized.session;
    const listed = await requestRemoteMcp(server, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, session);
    session = listed.session;
    const result = listed.messages.find((message) => message?.id === 2)?.result;
    return Array.isArray(result?.tools)
      ? result.tools.flatMap((tool: any) => typeof tool?.name === "string" ? [{ name: tool.name, description: typeof tool.description === "string" ? tool.description : "" }] : [])
      : [];
  } finally {
    await closeRemoteMcp(server, session);
  }
}

const proxyPath = () => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "mcp-http-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
};

export function mcpStdioConfigs(
  integrations: McpIntegration[] | undefined,
  options: { inheritCredentials?: boolean } = {},
): McpStdioConfig[] {
  return (integrations ?? []).map((server) => ({
    command: process.execPath,
    args: [proxyPath()],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      XINYUN_MCP_URL: server.url,
      XINYUN_MCP_NAME: server.id,
      ...(server.auth?.token
        ? options.inheritCredentials
          ? { XINYUN_MCP_AUTH_TOKEN_ENV: mcpTokenEnvName(server.id) }
          : { XINYUN_MCP_AUTH_TOKEN: server.auth.token }
        : {}),
      ...(server.auth?.type ? { XINYUN_MCP_AUTH_TYPE: server.auth.type } : {}),
      ...(server.auth?.header ? { XINYUN_MCP_AUTH_HEADER: server.auth.header } : {}),
      ...(server.allowedTools !== undefined ? { XINYUN_MCP_ALLOWED_TOOLS: JSON.stringify(server.allowedTools) } : {}),
    },
  }));
}

function mcpTokenEnvName(id: string): string {
  return `XINYUN_MCP_TOKEN_${id.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

/** Codex inherits this environment from its app-server child. Keeping the
 * actual token here avoids putting it in repeated `-c` command-line args. */
export function mcpEnvironment(integrations: McpIntegration[] | undefined): Record<string, string> {
  return Object.fromEntries(
    (integrations ?? [])
      .filter((server) => server.auth?.token)
      .map((server) => [mcpTokenEnvName(server.id), server.auth!.token!]),
  );
}
