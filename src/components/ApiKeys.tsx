// Paste-a-key rows for PUT /api/config. The server persists to
// ~/.openmausbot/config.json and hot-reloads the provider fleet; secrets
// are write-only — GET /api/config returns configured flags, never values.
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import type { DomesticModelProviderId } from "@/lib/domestic-models";

// ── simple single-value sections (Composio, Box) ──────────────────────────

export type ConfigSection = "composio" | "composioApi" | "box";

const SECTIONS: Record<
  ConfigSection,
  { body: (value: string) => unknown; flag: (config: ConfigStatus) => boolean }
> = {
  composio: { body: (v) => ({ composio: { key: v } }), flag: (c) => c.composio.configured },
  composioApi: {
    body: (v) => ({ composio: { apiKey: v } }),
    flag: (c) => c.composio.apiKeyConfigured ?? false,
  },
  box: { body: (v) => ({ box: { token: v } }), flag: (c) => c.box.configured },
};

export function ApiKeyRow({
  section,
  label,
  placeholder,
  onSaved,
}: {
  section: ConfigSection;
  label: string;
  placeholder: string;
  onSaved?: (configured: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = state.config ? SECTIONS[section].flag(state.config) : false;
  const clearing = !value.trim() && configured;

  const save = () => {
    if (saving || (!value.trim() && !configured)) return;
    setSaving(true);
    setError(null);
    api("/api/config", {
      method: "PUT",
      body: JSON.stringify(SECTIONS[section].body(value.trim())),
    })
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setValue("");
        onSaved?.(SECTIONS[section].flag(status));
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
        <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
        {label}
        {configured && <span className="text-[11px] text-success">已连接</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={configured ? "••••••••  (粘贴以替换)" : placeholder}
          autoComplete="off"
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />
        <button
          onClick={save}
          disabled={saving || (!value.trim() && !configured)}
          className={cn(
            "flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px]",
            clearing ? "bg-raised text-danger hover:bg-raised-hover" : "bg-raised text-ink hover:bg-raised-hover",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          title={clearing ? "删除已保存的密钥" : "保存"}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : clearing ? "清除" : <><Check size={13} />保存</>}
        </button>
      </div>
      {error && <div className="mt-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

// ── proxy sections (Claude / Codex / Grok): key + base URL pair ───────────

export type ProxySection = "anthropic" | "openai" | "gemini" | "xai" | DomesticModelProviderId;

const fields = (key: string, url: string, clear: boolean) =>
  clear
    ? { key: "", url: "" }
    : {
        ...(key ? { key } : {}),
        ...(url ? { url } : {}),
      };

const PROXY_SECTIONS: Record<
  ProxySection,
  {
    body: (key: string, url: string, clear: boolean) => unknown;
    flag: (config: ConfigStatus) => boolean;
  }
> = {
  anthropic: {
    body: (k, u, clear) => ({ anthropic: fields(k, u, clear) }),
    flag: (c) => c.anthropic?.configured ?? false,
  },
  openai: {
    body: (k, u, clear) => ({ openai: fields(k, u, clear) }),
    flag: (c) => c.openai?.configured ?? false,
  },
  xai: {
    body: (k, u, clear) => ({ xai: fields(k, u, clear) }),
    flag: (c) => c.xai?.configured ?? false,
  },
  gemini: {
    body: (k, u, clear) => ({ gemini: fields(k, u, clear) }),
    flag: (c) => c.gemini?.configured ?? false,
  },
  deepseek: {
    body: (k, u, clear) => ({ domestic: { deepseek: fields(k, u, clear) } }),
    flag: (c) => c.domestic?.deepseek.configured ?? false,
  },
  zhipu: {
    body: (k, u, clear) => ({ domestic: { zhipu: fields(k, u, clear) } }),
    flag: (c) => c.domestic?.zhipu.configured ?? false,
  },
  dashscope: {
    body: (k, u, clear) => ({ domestic: { dashscope: fields(k, u, clear) } }),
    flag: (c) => c.domestic?.dashscope.configured ?? false,
  },
  moonshot: {
    body: (k, u, clear) => ({ domestic: { moonshot: fields(k, u, clear) } }),
    flag: (c) => c.domestic?.moonshot.configured ?? false,
  },
};

export function ProxyRow({
  section,
  label,
  keyPlaceholder,
  urlPlaceholder,
}: {
  section: ProxySection;
  label: string;
  keyPlaceholder: string;
  urlPlaceholder: string;
}) {
  const { state, dispatch } = useStore();
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<{ ok: boolean; count?: number; error?: string } | null>(null);

  const configured = state.config ? PROXY_SECTIONS[section].flag(state.config) : false;
  const clearing = configured && !key.trim() && !url.trim();
  const canSave = Boolean(key.trim() || url.trim() || clearing);

  const save = () => {
    if (saving || !canSave) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    api("/api/config", {
      method: "PUT",
      body: JSON.stringify(PROXY_SECTIONS[section].body(key.trim(), url.trim(), clearing)),
    })
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setKey("");
        setUrl("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const discover = () => {
    if (discovering || !configured) return;
    setDiscovering(true);
    setDiscoverResult(null);
    api(`/api/relay/${section}/discover-models`, { method: "POST" })
      .then((result: { ok: boolean; count?: number; error?: string }) => {
        setDiscoverResult(result);
        if (result.ok) {
          setTimeout(() => setDiscoverResult(null), 3000);
        }
      })
      .catch((e) => setDiscoverResult({ ok: false, error: e.message }))
      .finally(() => setDiscovering(false));
  };

  const inputCls =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
        <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
        {label}
        {configured && <span className="text-[11px] text-success">已配置</span>}
      </div>
      <div className="flex flex-col gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={configured ? "••••••••  (粘贴新密钥以替换)" : keyPlaceholder}
          autoComplete="off"
          className={inputCls}
        />
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={urlPlaceholder}
            className={inputCls}
          />
          <button
            onClick={save}
            disabled={saving || !canSave}
            className={cn(
              "flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px]",
              clearing ? "bg-raised text-danger hover:bg-raised-hover" : "bg-raised text-ink hover:bg-raised-hover",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            title={clearing ? "清除该服务的 URL 与 API Key" : "保存"}
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : saved ? (
              <><Check size={13} className="text-success" />已存</>
            ) : clearing ? (
              "清除"
            ) : (
              <><Check size={13} />保存</>
            )}
          </button>
        </div>
        {configured && (
          <button
            onClick={discover}
            disabled={discovering}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px]",
              "bg-raised text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {discovering ? (
              <><Loader2 size={13} className="animate-spin" />获取中...</>
            ) : discoverResult?.ok ? (
              <><Check size={13} className="text-success" />已获取 {discoverResult.count} 个模型</>
            ) : (
              "获取模型"
            )}
          </button>
        )}
        {discoverResult && !discoverResult.ok && (
          <div className="text-[12px] text-danger">{discoverResult.error}</div>
        )}
      </div>
      {error && <div className="mt-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
