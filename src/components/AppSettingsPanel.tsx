// App-level settings shared by all bots. Per-bot identity, model, computer,
// and voice tuning live in SettingsPanel.
import { BrainCircuit, Check, Cloud, Cpu, Download, Link2, Palette, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow, ProxyRow } from "./ApiKeys";
import { EngineHealthRow, EngineRefreshButton } from "./EngineHealth";
import { useUpdaterState } from "@/lib/updater";
import { zhCN } from "@/locales/zh-CN";
import { cn } from "@/lib/cn";
import { VoiceSettings } from "./VoiceSettings";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { DOMESTIC_MODEL_PROVIDERS } from "@/lib/domestic-models";
import {
  APP_THEME_OPTIONS,
  applyAppTheme,
  readAppTheme,
  syncWindowTitleBarColor,
  type AppThemePreference,
} from "@/lib/theme";

type SectionId = "appearance" | "engines" | "voice" | "profile" | "domestic" | "relay" | "connections" | "updates";

function AppearanceSettings({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [preference, setPreference] = useState<AppThemePreference>(() => readAppTheme());

  const select = (next: AppThemePreference) => {
    setPreference(applyAppTheme(next));
    syncWindowTitleBarColor("panel");
  };

  const selectedTheme = APP_THEME_OPTIONS.find((theme) => theme.id === preference.id)?.label ?? "自定义色调";
  return (
    <SettingsDisclosure
      icon={Palette}
      title={zhCN.appSettings.appearance}
      description={zhCN.appSettings.appearanceDesc}
      summary={selectedTheme}
      open={open}
      onToggle={onToggle}
    >
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={zhCN.appSettings.backgroundTheme}>
        {APP_THEME_OPTIONS.map((theme) => {
          const selected = preference.id === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => select({ ...preference, id: theme.id })}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border",
                selected
                  ? "border-accent-border bg-raised text-ink"
                  : "border-hairline/40 bg-inset text-ink-secondary hover:bg-raised hover:text-ink",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border shadow-inner",
                  theme.id === "white" ? "border-black/15" : "border-white/15",
                )}
                style={{ backgroundColor: theme.preview }}
              >
                {selected && <Check size={14} className={theme.id === "white" ? "text-slate-700" : "text-white drop-shadow"} />}
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
    </SettingsDisclosure>
  );
}

function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    })
      .then((response) => response.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };
  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(event) => setName(event.target.value)} onBlur={save} placeholder={zhCN.appSettings.namePlaceholder} className={inputClass} />
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onBlur={save}
        placeholder={zhCN.appSettings.emailPlaceholder}
        className={inputClass}
      />
    </div>
  );
}

function UpdatesContent() {
  const state = useUpdaterState();
  if (!window.ogb?.updater) return <div className="text-[12px] text-ink-secondary">开发模式下不提供自动更新。</div>;
  const updater = window.ogb.updater;
  const label =
    state?.status === "checking"
      ? "正在检查…"
      : state?.status === "available"
        ? `发现新版本 ${state.version}`
        : state?.status === "downloading"
          ? `正在下载… ${Math.round(state.percent ?? 0)}%`
          : state?.status === "downloaded"
            ? `${state.version} 已就绪 — 重启后应用`
            : state?.status === "error"
              ? `检查失败：${state.message ?? "未知错误"}`
              : "当前已是最新版本。";
  return (
    <div>
      <div className="text-[13px] text-ink-secondary">{label}</div>
      <div className="mt-3 flex gap-2">
        {state?.status === "available" ? (
          <button onClick={() => void updater.download()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white">下载更新</button>
        ) : state?.status === "downloaded" ? (
          <button onClick={() => void updater.install()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white">重启并更新</button>
        ) : (
          <button
            onClick={() => void updater.check()}
            disabled={state?.status === "checking" || state?.status === "downloading"}
            className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
          >
            检查更新
          </button>
        )}
      </div>
    </div>
  );
}

function EngineHealthSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = state.instances.filter((instance) => instance.snapshot.state === "available").length;

  const refresh = async () => {
    setChecking(true);
    setError(null);
    try {
      await refreshInstances();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingsDisclosure
      icon={Cpu}
      title="AI 引擎状态"
      description="统一查看 CLI 登录、中转站和工具能力。"
      summary={`已就绪 ${available}/${state.instances.length}`}
      open={open}
      onToggle={onToggle}
    >
      <div className="mb-2 flex justify-end">
        <EngineRefreshButton onRefresh={() => void refresh()} busy={checking} />
      </div>
      <div className="divide-y divide-hairline/30">
        {state.instances.map((instance) => (
          <div key={instance.instanceId} className="py-2.5 first:pt-0 last:pb-0">
            <EngineHealthRow instance={instance} compact />
          </div>
        ))}
      </div>
      {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">检查失败：{error}</div>}
    </SettingsDisclosure>
  );
}

export function AppSettingsPanel() {
  const { dispatch } = useStore();
  const [openSection, setOpenSection] = useState<SectionId | null>("voice");
  const isWin = window.ogb?.platform === "win32";
  const drag = isWin ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDrag = isWin ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;
  const toggle = (section: SectionId) => setOpenSection((current) => current === section ? null : section);

  useEffect(() => {
    syncWindowTitleBarColor("panel");
    return () => syncWindowTitleBarColor("app");
  }, []);

  return (
    <aside className="animate-panel-in flex h-full w-full min-w-0 flex-col bg-panel">
      <div className={cn("flex min-h-[46px] items-center gap-2 border-b border-hairline/25 px-3", isWin && "pr-[144px]")} style={drag}>
        <button
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label="关闭应用设置"
          style={noDrag}
        >
          <X size={17} />
        </button>
        <span className="whitespace-nowrap text-[15px] font-semibold text-ink">{zhCN.appSettings.title}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-5 pt-3">
        <div className="space-y-3">
          <AppearanceSettings open={openSection === "appearance"} onToggle={() => toggle("appearance")} />
          <EngineHealthSection open={openSection === "engines"} onToggle={() => toggle("engines")} />
          <VoiceSettings open={openSection === "voice"} onToggle={() => toggle("voice")} />

          <SettingsDisclosure
            icon={UserRound}
            title={zhCN.appSettings.profile}
            description={zhCN.appSettings.profileDesc}
            summary="姓名与邮箱"
            open={openSection === "profile"}
            onToggle={() => toggle("profile")}
          >
            <ProfileFields />
          </SettingsDisclosure>

          <SettingsDisclosure
            icon={BrainCircuit}
            title="国产模型 API"
            description="直接连接 DeepSeek、智谱 GLM、通义千问和 Kimi。"
            summary="4 个服务预设"
            open={openSection === "domestic"}
            onToggle={() => toggle("domestic")}
          >
            <div className="divide-y divide-hairline/30">
              {DOMESTIC_MODEL_PROVIDERS.map((provider) => (
                <div key={provider.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="mb-2 text-[11px] text-ink-secondary">{provider.description}</div>
                  <ProxyRow
                    section={provider.id}
                    label={provider.label}
                    keyPlaceholder="sk-… API Key"
                    urlPlaceholder={provider.url}
                  />
                </div>
              ))}
            </div>
          </SettingsDisclosure>

          <SettingsDisclosure
            icon={Cloud}
            title="AI 中转站配置"
            description="配置 Claude、Codex 和 Grok 的兼容中转站。"
            summary="3 个服务"
            open={openSection === "relay"}
            onToggle={() => toggle("relay")}
          >
            <div className="flex flex-col gap-5">
              <ProxyRow section="anthropic" label="Claude (Anthropic)" keyPlaceholder="sk-… 中转站密钥" urlPlaceholder="https://your-proxy.com/v1" />
              <ProxyRow section="openai" label="Codex (OpenAI)" keyPlaceholder="sk-… 中转站密钥" urlPlaceholder="https://your-proxy.com/v1" />
              <ProxyRow section="xai" label="Grok (xAI)" keyPlaceholder="xai-… 中转站密钥" urlPlaceholder="https://your-proxy.com/v1" />
            </div>
          </SettingsDisclosure>

          <SettingsDisclosure
            icon={Link2}
            title={zhCN.appSettings.connections}
            description={zhCN.appSettings.connectionsDesc}
            summary="Composio 与 Box"
            open={openSection === "connections"}
            onToggle={() => toggle("connections")}
          >
            <div className="flex flex-col gap-4">
              <ApiKeyRow section="composio" label={zhCN.appSettings.composioKey} placeholder="ck_…" />
              <ApiKeyRow section="composioApi" label={zhCN.appSettings.composioApiKey} placeholder={zhCN.appSettings.composioApiPlaceholder} />
              <ApiKeyRow section="box" label={zhCN.appSettings.boxToken} placeholder={zhCN.appSettings.boxTokenPlaceholder} />
            </div>
          </SettingsDisclosure>

          <SettingsDisclosure
            icon={Download}
            title="应用更新"
            description="检查、下载并安装 XinyunOpen Bot 新版本。"
            open={openSection === "updates"}
            onToggle={() => toggle("updates")}
          >
            <UpdatesContent />
          </SettingsDisclosure>
        </div>
      </div>
    </aside>
  );
}
