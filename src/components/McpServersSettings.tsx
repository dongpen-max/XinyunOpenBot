import { Check, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { api } from "@/state/store";

interface McpTool {
  name: string;
  description: string;
  allowed: boolean;
}

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authConfigured: boolean;
  authType: "bearer" | "apiKey" | null;
  /** null means all advertised tools; [] means no tools. */
  allowedTools: string[] | null;
  tools: McpTool[];
  lastCheckedAt: string | null;
  health: "unknown" | "online" | "error";
}

const inputCls = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

function checkedAtLabel(value: string | null) {
  if (!value) return "尚未检测";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "已检测" : `检测于 ${date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

function healthLabel(server: McpServer) {
  if (!server.enabled) return "已停用";
  if (server.health === "online") return "连接正常";
  if (server.health === "error") return "连接异常";
  return "等待检测";
}

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

  const refresh = () => api("/api/mcp/servers")
    .then((result) => setServers(result.servers ?? []))
    .catch((reason) => setError(reason.message));

  useEffect(() => { void refresh(); }, []);

  const replaceServer = (server: McpServer) => {
    setServers((current) => current.map((item) => item.id === server.id ? server : item));
  };

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
        return refresh();
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setSaving(false));
  };

  const test = (server: McpServer) => {
    setBusy(`test:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}/test`, { method: "POST" })
      .then((result) => {
        if (result.server) replaceServer(result.server);
        setTested((current) => ({ ...current, [server.id]: `连接成功，发现 ${result.tools?.length ?? 0} 个工具` }));
      })
      .catch((reason) => {
        setError(`${server.name}：${reason.message}`);
        void refresh();
      })
      .finally(() => setBusy(null));
  };

  const toggle = (server: McpServer) => {
    setBusy(`toggle:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !server.enabled }) })
      .then((result) => result.server ? replaceServer(result.server) : refresh())
      .catch((reason) => setError(reason.message))
      .finally(() => setBusy(null));
  };

  const updateAllowedTools = (server: McpServer, allowedTools: string[]) => {
    setBusy(`tools:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}`, { method: "PATCH", body: JSON.stringify({ allowedTools }) })
      .then((result) => result.server ? replaceServer(result.server) : refresh())
      .catch((reason) => setError(`${server.name}：${reason.message}`))
      .finally(() => setBusy(null));
  };

  const toggleTool = (server: McpServer, tool: McpTool) => {
    const allowed = new Set(server.tools.filter((item) => item.allowed).map((item) => item.name));
    if (tool.allowed) allowed.delete(tool.name);
    else allowed.add(tool.name);
    updateAllowedTools(server, [...allowed]);
  };

  const remove = (server: McpServer) => {
    setBusy(`delete:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}`, { method: "DELETE" })
      .then(() => refresh())
      .catch((reason) => setError(reason.message))
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-hairline/40 bg-inset p-3">
        <div className="mb-2 text-[12px] leading-relaxed text-ink-secondary">支持 Streamable HTTP MCP。令牌仅保存在本机；连接成功后可逐项控制模型能够使用的工具。</div>
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
          className="ui-pressable mt-2 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 添加 MCP 服务
        </button>
      </div>

      {servers.map((server) => {
        const tools = server.tools ?? [];
        const allowedCount = tools.filter((tool) => tool.allowed).length;
        const toolsBusy = busy === `tools:${server.id}`;
        return (
          <div key={server.id} className="rounded-lg border border-hairline/40 bg-card">
            <div className="flex items-start gap-3 p-3">
              <span className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                !server.enabled ? "bg-raised-hover" : server.health === "online" ? "bg-success" : server.health === "error" ? "bg-danger" : "bg-warning",
              )} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                  {server.name}
                  <span className="font-mono text-[10px] text-ink-secondary">{server.id}</span>
                  {server.authConfigured && <span className="text-[10px] text-success">已配置令牌</span>}
                </div>
                <div className="truncate text-[11px] text-ink-secondary">{server.url}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-secondary">
                  <span>{healthLabel(server)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{checkedAtLabel(server.lastCheckedAt)}</span>
                </div>
                {tested[server.id] && <div className="mt-1 flex items-center gap-1 text-[11px] text-success"><Check size={12} />{tested[server.id]}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => test(server)} disabled={busy !== null} className="ui-pressable rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50" title="刷新工具和连接状态" aria-label={`刷新 ${server.name} 工具`}>
                  {busy === `test:${server.id}` ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                </button>
                <button type="button" onClick={() => toggle(server)} disabled={busy !== null} className="ui-pressable rounded-md px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
                  {server.enabled ? "停用" : "启用"}
                </button>
                <button type="button" onClick={() => remove(server)} disabled={busy !== null} className="ui-pressable rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger disabled:opacity-50" title="删除服务" aria-label={`删除 ${server.name}`}>
                  {busy === `delete:${server.id}` ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </div>
            </div>

            <div className="border-t border-hairline/30 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldCheck size={15} className="shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[12px] font-medium text-ink">工具权限</div>
                    <div className="text-[10px] text-ink-secondary">{tools.length ? `已允许 ${allowedCount}/${tools.length} 个工具` : "刷新连接后显示工具清单"}</div>
                  </div>
                </div>
                {tools.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={busy !== null || allowedCount === tools.length} onClick={() => updateAllowedTools(server, tools.map((tool) => tool.name))} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部启用</button>
                    <button type="button" disabled={busy !== null || allowedCount === 0} onClick={() => updateAllowedTools(server, [])} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部停用</button>
                  </div>
                )}
              </div>

              {tools.length > 0 && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-hairline/30 bg-inset/50">
                  {tools.map((tool) => (
                    <label key={tool.name} className="flex cursor-pointer items-start gap-2.5 border-b border-hairline/25 px-2.5 py-2 last:border-b-0 hover:bg-raised/45">
                      <input
                        type="checkbox"
                        checked={tool.allowed}
                        disabled={busy !== null || !server.enabled}
                        onChange={() => toggleTool(server, tool)}
                        className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono text-[11px] font-medium text-ink">{tool.name}</span>
                        {tool.description && <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-secondary">{tool.description}</span>}
                      </span>
                      {toolsBusy && <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-ink-secondary" />}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!servers.length && <div className="py-3 text-center text-[12px] text-ink-secondary">尚未添加 MCP 服务。添加后可检测并管理它提供的工具。</div>}
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
