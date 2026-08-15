// App-level settings, in the right-side slot: who you are + credentials
// shared by all bots. Per-bot settings (name, persona, model, computer)
// live in SettingsPanel; contextual Box-token entry stays in ComputerPanel.
import { Check, Cpu, Palette, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow, ProxyRow } from "./ApiKeys";
import { EngineHealthRow, EngineRefreshButton } from "./EngineHealth";
import { useUpdaterState } from "@/lib/updater";
import { zhCN } from "@/locales/zh-CN";
import {
  APP_THEME_OPTIONS,
  applyAppTheme,
  readAppTheme,
  type AppThemePreference,
} from "@/lib/theme";

function AppearanceSettings() {
  const [preference, setPreference] = useState<AppThemePreference>(() => readAppTheme());

  const select = (next: AppThemePreference) => {
    setPreference(applyAppTheme(next));
  };

  return (
    <div className="mt-2 rounded-xl bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Palette size={18} />
        </span>
        <div>
          <div className="text-[15px] font-medium text-ink">{zhCN.appSettings.appearance}</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
            {zhCN.appSettings.appearanceDesc}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label={zhCN.appSettings.backgroundTheme}>
        {APP_THEME_OPTIONS.map((theme) => {
          const selected = preference.id === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => select({ ...preference, id: theme.id })}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-accent-border bg-raised text-ink"
                  : "border-hairline/40 bg-inset text-ink-secondary hover:bg-raised hover:text-ink"
              }`}
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/15 shadow-inner"
                style={{ backgroundColor: theme.preview }}
              >
                {selected && <Check size={14} className="text-white drop-shadow" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{theme.label}</span>
                <span className="block truncate text-[11px] opacity-70">{theme.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <label className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2">
        <span>
          <span className="block text-[13px] font-medium text-ink">{zhCN.appSettings.customTone}</span>
          <span className="block text-[11px] text-ink-secondary">{zhCN.appSettings.customToneDesc}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase text-ink-secondary">{preference.customColor}</span>
          <input
            type="color"
            value={preference.customColor}
            aria-label={zhCN.appSettings.customTone}
            onChange={(event) => select({ id: "custom", customColor: event.target.value })}
            className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        </span>
      </label>
    </div>
  );
}

/** Name + email, persisted to /api/config {profile} on blur. Prefilled from
 * the current config (the values are echoed back — they're not secrets). */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  // adopt late-arriving config exactly once per open (config loads async)
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} placeholder={zhCN.appSettings.namePlaceholder} className={inputClass} />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={save}
        placeholder={zhCN.appSettings.emailPlaceholder}
        className={inputClass}
      />
    </div>
  );
}

/** Manual update check row — packaged app only (no bridge in dev). */
function UpdatesRow() {
  const s = useUpdaterState();
  if (!window.ogb?.updater) return null;
  const updater = window.ogb.updater;
  const label =
    s?.status === "checking"
      ? "正在检查…"
      : s?.status === "available"
        ? `发现新版本 ${s.version}`
        : s?.status === "downloading"
          ? `正在下载… ${Math.round(s.percent ?? 0)}%`
          : s?.status === "downloaded"
            ? `${s.version} 已就绪 — 重启后应用`
            : s?.status === "error"
              ? `检查失败：${s.message ?? "未知错误"}`
              : "当前已是最新版本。";
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">应用更新</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{label}</div>
      <div className="mt-3 flex gap-2">
        {s?.status === "available" ? (
          <button
            onClick={() => void updater.download()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            下载更新
          </button>
        ) : s?.status === "downloaded" ? (
          <button
            onClick={() => void updater.install()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            重启并更新
          </button>
        ) : (
          <button
            onClick={() => void updater.check()}
            disabled={s?.status === "checking" || s?.status === "downloading"}
            className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
          >
            检查更新
          </button>
        )}
      </div>
    </div>
  );
}

function EngineHealthSection() {
  const { state, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = state.instances.filter((instance) => instance.snapshot.state === "available").length;

  const refresh = async () => {
    setChecking(true);
    setError(null);
    try {
      await refreshInstances();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Cpu size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-medium text-ink">AI 引擎状态</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              已就绪 {available}/{state.instances.length} 个；CLI 登录和中转站配置会在此统一显示。
            </div>
          </div>
        </div>
        <EngineRefreshButton onRefresh={() => void refresh()} busy={checking} />
      </div>
      <div className="mt-3 divide-y divide-hairline/30">
        {state.instances.map((instance) => (
          <div key={instance.instanceId} className="py-2.5 first:pt-0 last:pb-0">
            <EngineHealthRow instance={instance} compact />
          </div>
        ))}
      </div>
      {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">检查失败：{error}</div>}
    </div>
  );
}

export function AppSettingsPanel() {
  const { dispatch } = useStore();

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-6" />
        <span className="text-[15px] font-semibold text-ink">{zhCN.appSettings.title}</span>
        <button
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <AppearanceSettings />

        <EngineHealthSection />

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">{zhCN.appSettings.profile}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">{zhCN.appSettings.profileDesc}</div>
          <div className="mt-4">
            <ProfileFields />
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">AI 中转站配置</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            填入中转站提供的 API 密钥和 URL，保存后立即生效，无需重启。
          </div>
          <div className="mt-4 flex flex-col gap-5">
            <ProxyRow
              section="anthropic"
              label="Claude (Anthropic)"
              keyPlaceholder="sk-… 中转站密钥"
              urlPlaceholder="https://your-proxy.com/v1"
            />
            <ProxyRow
              section="openai"
              label="Codex (OpenAI)"
              keyPlaceholder="sk-… 中转站密钥"
              urlPlaceholder="https://your-proxy.com/v1"
            />
            <ProxyRow
              section="xai"
              label="Grok (xAI)"
              keyPlaceholder="xai-… 中转站密钥"
              urlPlaceholder="https://your-proxy.com/v1"
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">{zhCN.appSettings.connections}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {zhCN.appSettings.connectionsDesc}
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ApiKeyRow section="composio" label={zhCN.appSettings.composioKey} placeholder="ck_…" />
            <ApiKeyRow
              section="composioApi"
              label={zhCN.appSettings.composioApiKey}
              placeholder={zhCN.appSettings.composioApiPlaceholder}
            />
            <ApiKeyRow section="box" label={zhCN.appSettings.boxToken} placeholder={zhCN.appSettings.boxTokenPlaceholder} />
          </div>
        </div>

        <UpdatesRow />
      </div>
    </aside>
  );
}
