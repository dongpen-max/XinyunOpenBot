import type { McpServerConfig } from "./config.ts";

export interface McpRemoteSession {
  sessionId?: string;
}

function requestHeaders(server: McpServerConfig, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const token = server.auth?.token?.trim();
  if (token) {
    if (server.auth?.type === "bearer") headers.authorization = `Bearer ${token}`;
    else headers[server.auth?.header?.trim() || "x-api-key"] = token;
  }
  return headers;
}

export function parseMcpMessages(body: string): any[] {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("MCP server returned an empty response");
  if (trimmed.startsWith("{")) return [JSON.parse(trimmed)];
  const messages: any[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    messages.push(JSON.parse(data));
  }
  if (!messages.length) throw new Error("MCP server returned no JSON-RPC message");
  return messages;
}

export async function requestRemoteMcp(
  server: McpServerConfig,
  message: Record<string, unknown>,
  session: McpRemoteSession = {},
): Promise<{ messages: any[]; session: McpRemoteSession }> {
  const res = await fetch(server.url, {
    method: "POST",
    headers: requestHeaders(server, session.sessionId),
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP server HTTP ${res.status}`);
  return {
    messages: parseMcpMessages(body),
    session: { sessionId: res.headers.get("mcp-session-id") ?? session.sessionId },
  };
}

export async function closeRemoteMcp(server: McpServerConfig, session: McpRemoteSession): Promise<void> {
  if (!session.sessionId) return;
  await fetch(server.url, {
    method: "DELETE",
    headers: requestHeaders(server, session.sessionId),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}
