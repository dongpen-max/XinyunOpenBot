import { Bot, Check, Clock3, Download, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { MAUS_COLORS } from "@/lib/mascot";
import { api, useStore } from "@/state/store";

interface McpTool {
  name: string;
  description: string;
  allowed: boolean;
  policy: "auto" | "ask" | "deny";
}

interface McpAuditEntry {
  id: string;
  startedAt: string;
  durationMs: number;
  botId: string | null;
  serverId: string;
  tool: string;
  ok: boolean;
}

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** null means every bot; [] means no bots. */
  botIds: string[] | null;
  authConfigured: boolean;
  authType: "bearer" | "apiKey" | null;
  /** null means all advertised tools; [] means no tools. */
  allowedTools: string[] | null;
  tools: McpTool[];
  lastCheckedAt: string | null;
  health: "unknown" | "online" | "error";
  lastCheckError: string | null;
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
  const { state } = useStore();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apiKey">("bearer");
  const [authHeader, setAuthHeader] = useState("X-API-Key");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => api("/api/mcp/servers")
    .then((result) => setServers(result.servers ?? []))
    .catch((reason) => setError(reason.message));

  const refreshAudit = () => api("/api/mcp/audit?limit=50")
    .then((result) => setAudit(result.entries ?? []))
    .catch(() => {});

  useEffect(() => {
    void refresh();
    void refreshAudit();
  }, []);

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

  const updateBotScope = (server: McpServer, botIds: string[] | null) => {
    setBusy(`bots:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}`, { method: "PATCH", body: JSON.stringify({ botIds }) })
      .then((result) => result.server ? replaceServer(result.server) : refresh())
      .catch((reason) => setError(`${server.name}：${reason.message}`))
      .finally(() => setBusy(null));
  };

  const toggleBot = (server: McpServer, botId: string) => {
    const allBotIds = state.bots.map((bot) => bot.id);
    const selected = server.botIds === null ? allBotIds : server.botIds;
    updateBotScope(server, selected.includes(botId) ? selected.filter((id) => id !== botId) : [...selected, botId]);
  };

  const exportConfig = () => {
    setBusy("export");
    setError(null);
    setNotice(null);
    api("/api/mcp/config/export")
      .then((bundle) => {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `xinyunopen-mcp-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(href);
        setNotice(`已导出 ${bundle.servers?.length ?? 0} 个服务，访问令牌已自动排除`);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setBusy(null));
  };

  const importConfig = (file: File | undefined) => {
    if (!file) return;
    setBusy("import");
    setError(null);
    setNotice(null);
    file.text()
      .then((text) => JSON.parse(text))
      .then((bundle) => api("/api/mcp/config/import", { method: "POST", body: JSON.stringify(bundle) }))
      .then((result) => {
        setServers(result.servers ?? []);
        setNotice(`已导入 ${result.imported ?? 0} 个服务；同名机器人范围已自动匹配，本机令牌保持不变`);
      })
      .catch((reason) => setError(reason instanceof SyntaxError ? "配置文件不是有效的 JSON" : reason.message))
      .finally(() => {
        if (importInputRef.current) importInputRef.current.value = "";
        setBusy(null);
      });
  };

  const updateToolPolicies = (server: McpServer, toolPolicies: Record<string, McpTool["policy"]>) => {
    setBusy(`tools:${server.id}`);
    setError(null);
    api(`/api/mcp/servers/${server.id}`, { method: "PATCH", body: JSON.stringify({ toolPolicies }) })
      .then((result) => result.server ? replaceServer(result.server) : refresh())
      .catch((reason) => setError(`${server.name}：${reason.message}`))
      .finally(() => setBusy(null));
  };

  const setToolPolicy = (server: McpServer, tool: McpTool, policy: McpTool["policy"]) => {
    updateToolPolicies(server, Object.fromEntries(server.tools.map((item) => [item.name, item.name === tool.name ? policy : item.policy])));
  };

  const setAllPolicies = (server: McpServer, policy: McpTool["policy"]) => {
    updateToolPolicies(server, Object.fromEntries(server.tools.map((tool) => [tool.name, policy])));
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
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div className="max-w-xl text-[12px] leading-relaxed text-ink-secondary">支持 Streamable HTTP MCP。令牌仅保存在本机；连接成功后可逐项控制模型能够使用的工具。</div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={exportConfig} disabled={busy !== null} className="ui-pressable flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
              {busy === "export" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 脱敏导出
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()} disabled={busy !== null} className="ui-pressable flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
              {busy === "import" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 导入
            </button>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => importConfig(event.target.files?.[0])} />
          </div>
        </div>
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
        const autoCount = tools.filter((tool) => tool.policy === "auto").length;
        const askCount = tools.filter((tool) => tool.policy === "ask").length;
        const denyCount = tools.filter((tool) => tool.policy === "deny").length;
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
                {server.health === "error" && server.lastCheckError && (
                  <div className="mt-1.5 flex items-start gap-2 rounded-md bg-danger/8 px-2 py-1.5 text-[10px] text-danger">
                    <span className="min-w-0 flex-1 break-words">{server.lastCheckError}</span>
                    <button type="button" onClick={() => test(server)} disabled={busy !== null} className="ui-pressable shrink-0 font-medium hover:underline disabled:opacity-50">重试</button>
                  </div>
                )}
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
                  <Bot size={15} className="shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[12px] font-medium text-ink">适用机器人</div>
                    <div className="text-[10px] text-ink-secondary">
                      {server.botIds === null ? "全部机器人均可使用" : `已启用 ${server.botIds.length}/${state.bots.length} 个机器人`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={busy !== null || server.botIds === null} onClick={() => updateBotScope(server, null)} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部启用</button>
                  <button type="button" disabled={busy !== null || server.botIds?.length === 0} onClick={() => updateBotScope(server, [])} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部关闭</button>
                </div>
              </div>
              {state.bots.length > 0 && (
                <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {state.bots.map((bot) => {
                    const selected = server.botIds === null || server.botIds.includes(bot.id);
                    return (
                      <button
                        key={bot.id}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => toggleBot(server, bot.id)}
                        className={cn(
                          "ui-pressable flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] disabled:opacity-50",
                          selected ? "border-success/35 bg-success/10 text-success" : "border-hairline/35 bg-inset text-ink-secondary hover:text-ink",
                        )}
                        aria-pressed={selected}
                      >
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: MAUS_COLORS[bot.color] }} />
                        <span className="max-w-32 truncate">{bot.name}</span>
                        {selected && <Check size={11} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-hairline/30 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldCheck size={15} className="shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[12px] font-medium text-ink">工具权限</div>
                    <div className="text-[10px] text-ink-secondary">{tools.length ? `自动 ${autoCount} · 询问 ${askCount} · 禁止 ${denyCount}` : "刷新连接后显示工具清单"}</div>
                  </div>
                </div>
                {tools.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={busy !== null || autoCount === tools.length} onClick={() => setAllPolicies(server, "auto")} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部自动</button>
                    <button type="button" disabled={busy !== null || askCount === tools.length} onClick={() => setAllPolicies(server, "ask")} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部询问</button>
                    <button type="button" disabled={busy !== null || denyCount === tools.length} onClick={() => setAllPolicies(server, "deny")} className="ui-pressable rounded-md px-2 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">全部禁止</button>
                  </div>
                )}
              </div>

              {tools.length > 0 && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-hairline/30 bg-inset/50">
                  {tools.map((tool) => (
                    <div key={tool.name} className="flex items-start gap-2.5 border-b border-hairline/25 px-2.5 py-2 last:border-b-0 hover:bg-raised/45">
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono text-[11px] font-medium text-ink">{tool.name}</span>
                        {tool.description && <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-secondary">{tool.description}</span>}
                      </span>
                      <span className="flex shrink-0 overflow-hidden rounded-md border border-hairline/35 bg-card" role="group" aria-label={`${tool.name} 权限策略`}>
                        {(["auto", "ask", "deny"] as const).map((policy) => (
                          <button
                            key={policy}
                            type="button"
                            disabled={busy !== null || !server.enabled}
                            onClick={() => setToolPolicy(server, tool, policy)}
                            className={cn(
                              "ui-pressable px-2 py-1 text-[10px] transition-colors disabled:opacity-40",
                              tool.policy === policy
                                ? policy === "deny" ? "bg-danger/15 text-danger" : policy === "ask" ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                                : "text-ink-secondary hover:bg-raised hover:text-ink",
                            )}
                          >
                            {policy === "auto" ? "自动" : policy === "ask" ? "询问" : "禁止"}
                          </button>
                        ))}
                      </span>
                      {toolsBusy && <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-ink-secondary" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!servers.length && <div className="py-3 text-center text-[12px] text-ink-secondary">尚未添加 MCP 服务。添加后可检测并管理它提供的工具。</div>}
      {notice && <div role="status" className="text-[12px] text-success">{notice}</div>}
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
      <div className="rounded-lg border border-hairline/40 bg-card">
        <div className="flex items-center justify-between border-b border-hairline/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Clock3 size={15} className="text-ink-secondary" />
            <div>
              <div className="text-[12px] font-medium text-ink">最近调用</div>
              <div className="text-[10px] text-ink-secondary">仅记录工具、时间、耗时和结果，不保存参数或返回正文</div>
            </div>
          </div>
          <button type="button" onClick={() => void refreshAudit()} className="ui-pressable rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="刷新 MCP 调用记录">
            <RefreshCw size={14} />
          </button>
        </div>
        {audit.length ? (
          <div className="max-h-56 overflow-y-auto">
            {audit.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 border-b border-hairline/25 px-3 py-2 text-[10px] last:border-b-0">
                <span className={cn("size-1.5 shrink-0 rounded-full", entry.ok ? "bg-success" : "bg-danger")} />
                <span className="min-w-0 flex-1 truncate text-ink"><span className="font-mono text-ink-secondary">{entry.serverId}/</span>{entry.tool}</span>
                <span className="shrink-0 text-ink-secondary">{entry.durationMs}ms</span>
                <span className="shrink-0 text-ink-secondary">{new Date(entry.startedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        ) : <div className="px-3 py-4 text-center text-[11px] text-ink-secondary">暂无 MCP 调用记录</div>}
      </div>
    </div>
  );
}
