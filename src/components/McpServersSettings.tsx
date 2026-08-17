import { Check, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authConfigured: boolean;
  authType: "bearer" | "apiKey" | null;
  allowedTools: string[];
}

const inputCls = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

export function McpServersSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apiKey">("bearer");
  const [authHeader, setAuthHeader] = useState("X-API-Key");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});

  const refresh = () => {
    void api("/api/mcp/servers")
      .then((result) => setServers(result.servers ?? []))
      .catch((reason) => setError(reason.message));
  };

  useEffect(refresh, []);

  const add = () => {
    if (!name.trim() || !url.trim() || saving) return;
    setSaving(true);
    setError(null);
    api("/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        url: url.trim(),
        ...(authType === "none" ? {} : { authType, ...(authType === "apiKey" ? { authHeader } : {}), ...(token.trim() ? { token: token.trim() } : {}) }),
      }),
    })
      .then(() => {
        setName("");
        setUrl("");
        setToken("");
        refresh();
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setSaving(false));
  };

  const test = (server: McpServer) => {
    setBusy(`test:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}/test`, { method: "POST" })
      .then((result) => setTested((current) => ({ ...current, [server.id]: `连接成功：${result.tools?.length ?? 0} 个工具` })))
      .catch((reason) => setError(`${server.name}：${reason.message}`))
      .finally(() => setBusy(null));
  };

  const toggle = (server: McpServer) => {
    setBusy(`toggle:${server.id}`);
    api(`/api/mcp/servers/${server.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !server.enabled }) })
      .then(refresh)
      .catch((reason) => setError(reason.message))
      .finally(() => setBusy(null));
  };

  const remove = (server: McpServer) => {
    setBusy(`delete:${server.id}`);
    api(`/api/mcp/servers/${server.id}`, { method: "DELETE" })
      .then(refresh)
      .catch((reason) => setError(reason.message))
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-hairline/40 bg-inset p-3">
        <div className="mb-2 text-[12px] text-ink-secondary">支持 Streamable HTTP MCP。可填写国内平台提供的 MCP 地址；令牌仅本机保存，不会再次显示。</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} placeholder="服务名称，例如：飞书" />
          <input className={inputCls} type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr]">
          <select className={inputCls} value={authType} onChange={(event) => setAuthType(event.target.value as typeof authType)}>
            <option value="bearer">Bearer Token</option>
            <option value="apiKey">API Key</option>
            <option value="none">无需授权</option>
          </select>
          {authType === "apiKey" ? (
            <input className={inputCls} value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} placeholder="API Key 请求头，例如 X-API-Key" />
          ) : <div className="hidden sm:block" />}
        </div>
        {authType !== "none" && <input className={cn(inputCls, "mt-2")} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="访问令牌（可留空以只保存地址）" autoComplete="off" />}
        <button
          type="button"
          onClick={add}
          disabled={!name.trim() || !url.trim() || saving}
          className="mt-2 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 添加 MCP 服务
        </button>
      </div>

      {servers.map((server) => (
        <div key={server.id} className="rounded-lg border border-hairline/40 bg-card p-3">
          <div className="flex items-start gap-3">
            <span className={cn("mt-1 size-2 shrink-0 rounded-full", server.enabled ? "bg-success" : "bg-raised-hover")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                {server.name}
                <span className="font-mono text-[10px] text-ink-secondary">{server.id}</span>
                {server.authConfigured && <span className="text-[10px] text-success">已配置令牌</span>}
              </div>
              <div className="truncate text-[11px] text-ink-secondary">{server.url}</div>
              {tested[server.id] && <div className="mt-1 flex items-center gap-1 text-[11px] text-success"><Check size={12} />{tested[server.id]}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => test(server)} disabled={busy !== null} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50" title="测试连接">
                {busy === `test:${server.id}` ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              </button>
              <button type="button" onClick={() => toggle(server)} disabled={busy !== null} className="rounded-md px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
                {server.enabled ? "停用" : "启用"}
              </button>
              <button type="button" onClick={() => remove(server)} disabled={busy !== null} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger disabled:opacity-50" title="删除服务">
                {busy === `delete:${server.id}` ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              </button>
            </div>
          </div>
        </div>
      ))}
      {!servers.length && <div className="py-2 text-center text-[12px] text-ink-secondary">尚未添加 MCP 服务。</div>}
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
