// App-level settings shared by all bots. Per-bot identity, model, computer,
// and voice tuning live in SettingsPanel.
import {
  BrainCircuit,
  Check,
  Cloud,
  Cpu,
  Download,
  Link2,
  Mic,
  Palette,
  PlugZap,
  Search,
  Settings2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow, ProxyRow } from "./ApiKeys";
import { EngineHealthRow, EngineRefreshButton } from "./EngineHealth";
import { useUpdaterState } from "@/lib/updater";
import { zhCN } from "@/locales/zh-CN";
import { cn } from "@/lib/cn";
import { VoiceSettings, VoiceSettingsContent } from "./VoiceSettings";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { DOMESTIC_MODEL_PROVIDERS } from "@/lib/domestic-models";
import { McpServersSettings } from "./McpServersSettings";
import {
  APP_THEME_OPTIONS,
  applyAppTheme,
  readAppTheme,
  syncWindowTitleBarColor,
  type AppThemePreference,
} from "@/lib/theme";

type QuickSectionId = "appearance" | "engines" | "voice" | "profile" | "domestic" | "relay" | "connections" | "mcp" | "updates";
type SettingsCategoryId = "general" | "engines" | "voice" | "connections" | "updates";

function AppearanceSettingsContent() {
  const [preference, setPreference] = useState<AppThemePreference>(() => readAppTheme());

  const select = (next: AppThemePreference) => {
    setPreference(applyAppTheme(next));
    syncWindowTitleBarColor("panel");
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1" role="radiogroup" aria-label={zhCN.appSettings.backgroundTheme}>
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
                "ui-pressable flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border",
                selected
                  ? "border-accent-border bg-raised text-ink"
                  : "border-hairline/45 bg-inset text-ink-secondary hover:bg-raised hover:text-ink",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border shadow-inner",
                  theme.id === "white" ? "border-black/15" : "border-white/15",
                )}
                style={{ backgroundColor: theme.preview }}
              >
                {selected && <Check size={14} className={theme.id === "white" ? "text-slate-700" : "text-white drop-shadow"} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{theme.label}</span>
                <span className="block truncate text-[11px] opacity-80">{theme.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-hairline/45 bg-inset px-3 py-2.5">
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
    </>
  );
}

function AppearanceSettings({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const preference = readAppTheme();
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
      <AppearanceSettingsContent />
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
    "w-full rounded-xl border border-hairline/45 bg-inset px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-secondary focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent-border";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-[12px] text-ink-secondary">
        姓名
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={save} placeholder={zhCN.appSettings.namePlaceholder} className={inputClass} />
      </label>
      <label className="grid gap-1.5 text-[12px] text-ink-secondary">
        邮箱
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={save}
          placeholder={zhCN.appSettings.emailPlaceholder}
          className={inputClass}
        />
      </label>
    </div>
  );
}

function UpdatesContent() {
  const state = useUpdaterState();
  if (!window.ogb?.updater) return <div className="text-[13px] text-ink-secondary">开发模式下不提供自动更新。</div>;
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
          <button onClick={() => void updater.download()} className="ui-pressable rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:brightness-110">下载更新</button>
        ) : state?.status === "downloaded" ? (
          <button onClick={() => void updater.install()} className="ui-pressable rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:brightness-110">重启并更新</button>
        ) : (
          <button
            onClick={() => void updater.check()}
            disabled={state?.status === "checking" || state?.status === "downloading"}
            className="ui-pressable rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
          >
            检查更新
          </button>
        )}
      </div>
    </div>
  );
}

function EngineHealthContent() {
  const { state, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <>
      <div className="mb-2 flex justify-end">
        <EngineRefreshButton onRefresh={() => void refresh()} busy={checking} />
      </div>
      <div className="divide-y divide-hairline/35">
        {state.instances.map((instance) => (
          <div key={instance.instanceId} className="py-2.5 first:pt-0 last:pb-0">
            <EngineHealthRow instance={instance} compact />
          </div>
        ))}
      </div>
      {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">检查失败：{error}</div>}
    </>
  );
}

function EngineHealthSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state } = useStore();
  const available = state.instances.filter((instance) => instance.snapshot.state === "available").length;
  return (
    <SettingsDisclosure
      icon={Cpu}
      title="AI 引擎状态"
      description="统一查看 CLI 登录、中转站和工具能力。"
      summary={`已就绪 ${available}/${state.instances.length}`}
      open={open}
      onToggle={onToggle}
    >
      <EngineHealthContent />
    </SettingsDisclosure>
  );
}

function DomesticModelsContent() {
  return (
    <div className="divide-y divide-hairline/35">
      {DOMESTIC_MODEL_PROVIDERS.map((provider) => (
        <div key={provider.id} className="py-4 first:pt-0 last:pb-0">
          <div className="mb-2 text-[12px] text-ink-secondary">{provider.description}</div>
          <ProxyRow section={provider.id} label={provider.label} keyPlaceholder="sk-… API Key" urlPlaceholder={provider.url} />
        </div>
      ))}
    </div>
  );
}

function RelaySettingsContent() {
  return (
    <div className="flex flex-col gap-5">
      <ProxyRow section="anthropic" label="Claude (Anthropic)" keyPlaceholder="sk-… 中转站密钥" urlPlaceholder="https://your-proxy.com/v1" />
      <ProxyRow section="openai" label="Codex (OpenAI)" keyPlaceholder="sk-… 中转站密钥" urlPlaceholder="https://your-proxy.com/v1" />
      <ProxyRow section="gemini" label="Gemini (Google)" keyPlaceholder="AIza… 或中转站密钥" urlPlaceholder="https://generativelanguage.googleapis.com/v1beta/openai" />
      <ProxyRow section="xai" label="Grok (xAI)" keyPlaceholder="xai-… 中转站密钥" urlPlaceholder="https://your-proxy.com/v1" />
    </div>
  );
}

function ConnectionsContent() {
  return (
    <div className="flex flex-col gap-4">
      <ApiKeyRow section="composio" label={zhCN.appSettings.composioKey} placeholder="ck_…" />
      <ApiKeyRow section="composioApi" label={zhCN.appSettings.composioApiKey} placeholder={zhCN.appSettings.composioApiPlaceholder} />
      <ApiKeyRow section="box" label={zhCN.appSettings.boxToken} placeholder={zhCN.appSettings.boxTokenPlaceholder} />
    </div>
  );
}

/** Compact right drawer kept as a fast path from the sidebar gear. */
export function AppSettingsPanel() {
  const { dispatch } = useStore();
  const [openSection, setOpenSection] = useState<QuickSectionId | null>("voice");
  const isWin = window.ogb?.platform === "win32";
  const drag = isWin ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDrag = isWin ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;
  const toggle = (section: QuickSectionId) => setOpenSection((current) => current === section ? null : section);

  useEffect(() => {
    syncWindowTitleBarColor("panel");
    return () => syncWindowTitleBarColor("app");
  }, []);

  return (
    <aside className="animate-panel-in flex h-full w-full min-w-0 flex-col bg-panel">
      <div className={cn("flex min-h-[46px] items-center gap-2 border-b border-hairline/30 px-3", isWin && "pr-[144px]")} style={drag}>
        <button
          onClick={() => dispatch({ type: "toggleAppQuickSettings", open: false })}
          className="ui-pressable rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label="关闭基础设置"
          style={noDrag}
        >
          <X size={17} />
        </button>
        <span className="whitespace-nowrap text-[15px] font-semibold text-ink">基础设置</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-5 pt-3">
        <div className="space-y-3">
          <AppearanceSettings open={openSection === "appearance"} onToggle={() => toggle("appearance")} />
          <EngineHealthSection open={openSection === "engines"} onToggle={() => toggle("engines")} />
          <VoiceSettings open={openSection === "voice"} onToggle={() => toggle("voice")} />
          <SettingsDisclosure icon={UserRound} title={zhCN.appSettings.profile} description={zhCN.appSettings.profileDesc} summary="姓名与邮箱" open={openSection === "profile"} onToggle={() => toggle("profile")}>
            <ProfileFields />
          </SettingsDisclosure>
          <SettingsDisclosure icon={BrainCircuit} title="国产模型 API" description="直接连接 DeepSeek、智谱 GLM、通义千问和 Kimi。" summary="4 个服务预设" open={openSection === "domestic"} onToggle={() => toggle("domestic")}>
            <DomesticModelsContent />
          </SettingsDisclosure>
          <SettingsDisclosure icon={Cloud} title="AI 中转站配置" description="配置 Claude、Codex、Gemini 和 Grok 的兼容中转站。" summary="4 个服务" open={openSection === "relay"} onToggle={() => toggle("relay")}>
            <RelaySettingsContent />
          </SettingsDisclosure>
          <SettingsDisclosure icon={Link2} title={zhCN.appSettings.connections} description={zhCN.appSettings.connectionsDesc} summary="Composio 与 Box" open={openSection === "connections"} onToggle={() => toggle("connections")}>
            <ConnectionsContent />
          </SettingsDisclosure>
          <SettingsDisclosure icon={PlugZap} title="通用 MCP 服务" description="接入国内软件或网站提供的 MCP 工具服务。" summary="HTTP MCP" open={openSection === "mcp"} onToggle={() => toggle("mcp")}>
            <McpServersSettings />
          </SettingsDisclosure>
          <SettingsDisclosure icon={Download} title="应用更新" description="检查、下载并安装 XinyunOpen Bot 新版本。" open={openSection === "updates"} onToggle={() => toggle("updates")}>
            <UpdatesContent />
          </SettingsDisclosure>
        </div>
      </div>
    </aside>
  );
}

const settingsCategories: Array<{
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
}> = [
  { id: "general", label: "常规", description: "个人资料与外观", icon: Settings2, keywords: ["个人", "姓名", "邮箱", "主题", "外观", "颜色"] },
  { id: "engines", label: "AI 引擎", description: "模型、状态与中转", icon: BrainCircuit, keywords: ["模型", "Claude", "Codex", "Gemini", "Grok", "DeepSeek", "中转站", "国产模型"] },
  { id: "voice", label: "语音", description: "识别、合成与输入", icon: Mic, keywords: ["语音", "麦克风", "语音输入", "TTS", "转写"] },
  { id: "connections", label: "连接与工具", description: "Composio、Box 与 MCP", icon: Link2, keywords: ["API", "密钥", "Composio", "Box", "MCP", "云电脑"] },
  { id: "updates", label: "更新", description: "版本检查与安装", icon: Download, keywords: ["版本", "自动更新", "下载", "安装"] },
];

function settingsCategoryMatches(category: (typeof settingsCategories)[number], query: string): boolean {
  if (!query) return true;
  return [category.label, category.description, ...category.keywords].some((value) => value.toLocaleLowerCase().includes(query));
}

function SettingsBlock({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <section className="app-settings-center__block">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-secondary">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SettingsCategoryPage({ category }: { category: SettingsCategoryId }) {
  if (category === "general") {
    return (
      <>
        <SettingsBlock icon={UserRound} title={zhCN.appSettings.profile} description={zhCN.appSettings.profileDesc}>
          <ProfileFields />
        </SettingsBlock>
        <SettingsBlock icon={Palette} title={zhCN.appSettings.appearance} description={zhCN.appSettings.appearanceDesc}>
          <AppearanceSettingsContent />
        </SettingsBlock>
      </>
    );
  }
  if (category === "engines") {
    return (
      <>
        <SettingsBlock icon={Cpu} title="AI 引擎状态" description="统一查看 CLI 登录、中转站和工具能力。">
          <EngineHealthContent />
        </SettingsBlock>
        <SettingsBlock icon={BrainCircuit} title="国产模型 API" description="直接连接 DeepSeek、智谱 GLM、通义千问和 Kimi。">
          <DomesticModelsContent />
        </SettingsBlock>
        <SettingsBlock icon={Cloud} title="AI 中转站配置" description="配置 Claude、Codex、Gemini 和 Grok 的兼容中转站。">
          <RelaySettingsContent />
        </SettingsBlock>
      </>
    );
  }
  if (category === "voice") {
    return (
      <SettingsBlock icon={Mic} title="语音聊天" description="配置识别、合成、麦克风输入和抢断行为。">
        <VoiceSettingsContent />
      </SettingsBlock>
    );
  }
  if (category === "connections") {
    return (
      <>
        <SettingsBlock icon={Link2} title={zhCN.appSettings.connections} description={zhCN.appSettings.connectionsDesc}>
          <ConnectionsContent />
        </SettingsBlock>
        <SettingsBlock icon={PlugZap} title="通用 MCP 服务" description="接入国内软件或网站提供的 MCP 工具服务。">
          <McpServersSettings />
        </SettingsBlock>
      </>
    );
  }
  return (
    <SettingsBlock icon={Download} title="应用更新" description="检查、下载并安装 XinyunOpen Bot 新版本。">
      <UpdatesContent />
    </SettingsBlock>
  );
}

/** Full settings center opened from the account menu and settings deep links. */
export function AppSettingsCenter() {
  const { dispatch } = useStore();
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [query, setQuery] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const active = settingsCategories.find((category) => category.id === activeCategory)!;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCategories = settingsCategories.filter((category) => settingsCategoryMatches(category, normalizedQuery));
  const isWin = window.ogb?.platform === "win32";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "toggleAppSettings", open: false });
    };
    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    syncWindowTitleBarColor("panel");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      syncWindowTitleBarColor("app");
    };
  }, [dispatch]);

  useEffect(() => {
    if (visibleCategories.some((category) => category.id === activeCategory)) return;
    if (visibleCategories[0]) setActiveCategory(visibleCategories[0].id);
  }, [activeCategory, visibleCategories]);

  return (
    <div
      className={cn("app-settings-center fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6", isWin && "pt-[52px]")}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) dispatch({ type: "toggleAppSettings", open: false });
      }}
      role="presentation"
    >
      <div className="app-settings-center__shell animate-pop-in" role="dialog" aria-modal="true" aria-labelledby="app-settings-center-title">
        <nav className="app-settings-center__nav" aria-label="设置分类">
          <div className="app-settings-center__brand">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Settings2 size={19} />
            </span>
            <div>
              <div id="app-settings-center-title" className="text-[16px] font-semibold text-ink">设置</div>
              <div className="text-[11px] text-ink-secondary">XinyunOpen Bot</div>
            </div>
          </div>
          <label className="app-settings-center__search">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                if (query) setQuery("");
                else dispatch({ type: "toggleAppSettings", open: false });
              }}
              placeholder="搜索设置"
              aria-label="搜索设置"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </label>
          <div className="app-settings-center__nav-list">
            {visibleCategories.map((category) => {
              const selected = category.id === activeCategory;
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn("app-settings-center__nav-item ui-pressable", selected && "app-settings-center__nav-item--active")}
                >
                  <Icon size={17} />
                  <span className="min-w-0 text-left">
                    <span className="block text-[13px] font-medium">{category.label}</span>
                    <span className="app-settings-center__nav-description block truncate text-[10.5px]">{category.description}</span>
                  </span>
                </button>
              );
            })}
            {visibleCategories.length === 0 && <div className="px-2 py-3 text-[12px] leading-relaxed text-ink-secondary">没有匹配的设置</div>}
          </div>
        </nav>

        <section className="app-settings-center__content">
          <header className="app-settings-center__header">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold text-ink">{active.label}</h2>
              <p className="mt-1 text-[12px] text-ink-secondary">{active.description}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
              className="ui-pressable flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
              aria-label="关闭设置"
            >
              <X size={18} />
            </button>
          </header>
          <div key={activeCategory} className="app-settings-center__scroll animate-pop-in">
            <SettingsCategoryPage category={activeCategory} />
          </div>
        </section>
      </div>
    </div>
  );
}
