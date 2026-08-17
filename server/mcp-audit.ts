import { appendFileSync, chmodSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export interface McpAuditEntry {
  id: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  botId: string | null;
  threadId: string;
  serverId: string;
  tool: string;
  ok: boolean;
}

const AUDIT_PATH = join(DATA_DIR, "mcp-audit.ndjson");
const ROTATED_PATH = join(DATA_DIR, "mcp-audit.previous.ndjson");
const MAX_BYTES = 2_000_000;

function safeText(value: string, max: number): string {
  return value.replace(/[\r\n\0]/g, " ").slice(0, max);
}

export function appendMcpAudit(entry: Omit<McpAuditEntry, "id">): McpAuditEntry {
  const record: McpAuditEntry = {
    ...entry,
    id: newId(),
    botId: entry.botId ? safeText(entry.botId, 80) : null,
    threadId: safeText(entry.threadId, 120),
    serverId: safeText(entry.serverId, 64),
    tool: safeText(entry.tool, 200),
    durationMs: Math.max(0, Math.round(entry.durationMs)),
  };
  try {
    if (existsSync(AUDIT_PATH) && statSync(AUDIT_PATH).size >= MAX_BYTES) {
      try { renameSync(AUDIT_PATH, ROTATED_PATH); } catch {}
    }
    appendFileSync(AUDIT_PATH, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    try { chmodSync(AUDIT_PATH, 0o600); } catch {}
  } catch {
    // Audit persistence must never break a model turn.
  }
  return record;
}

export function recentMcpAudit(limit = 50): McpAuditEntry[] {
  const count = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  try {
    const lines = readFileSync(AUDIT_PATH, "utf8").trim().split("\n").filter(Boolean).slice(-count);
    return lines.flatMap((line) => {
      try {
        const value = JSON.parse(line) as McpAuditEntry;
        return value && typeof value.tool === "string" && typeof value.serverId === "string" ? [value] : [];
      } catch {
        return [];
      }
    }).reverse();
  } catch {
    return [];
  }
}
