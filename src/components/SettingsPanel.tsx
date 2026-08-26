import { ChevronLeft, Crown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore, type Bot } from "@/state/store";
import {
  MASCOT_SHAPES,
  MODEL_AVATAR_OPTIONS,
  MausAvatar,
  ReferenceGrokAvatar,
  isModelAvatar,
  normalizeMascotShapeId,
  type MausShape,
} from "./Avatar";
import {
  PICKABLE_STATES,
  stateForBot,
  MAUS_COLORS,
  MAUS_COLOR_NAMES,
  MAUS_MOTIONS,
} from "@/lib/mascot";
import { ModelPicker } from "./ModelPicker";
import { cn } from "@/lib/cn";
import { zhCN } from "@/locales/zh-CN";

const ROUTING_MODES = [
  { id: "manual", label: "手动", description: "始终使用你选择的 Agent 和模型，不自动切换。" },
  { id: "balanced", label: "均衡", description: "综合可用性、拥堵和响应速度选择。" },
  { id: "quality", label: "质量", description: "优先可靠的质量数据；未知时保持首选顺序。" },
  { id: "speed", label: "速度", description: "优先低延迟且健康的候选。" },
  { id: "cost", label: "成本", description: "仅使用可靠成本数据；暂无数据时不猜价格。" },
] as const;

const ROUTING_ERROR_LABEL: Record<string, string> = {
  rate_limited: "达到限额",
  timeout: "请求超时",
  temporarily_unavailable: "服务暂时不可用",
  connection_lost: "连接中断",
  context_overflow: "上下文过长",
  authentication: "认证失败",
  configuration: "配置错误",
  cancelled: "已取消",
  task_error: "任务错误",
  unknown: "未知错误",
};
import { syncWindowTitleBarColor } from "@/lib/theme";
import { BotVoiceSettings } from "./BotVoiceSettings";

const SHAPE_GROUPS = [
  { id: "base", label: "基础形态" },
  { id: "animal", label: "动物伙伴" },
] as const;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] text-ink-secondary">{label}</div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none focus:border-hairline";

export function SettingsPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const panelRef = useRef<HTMLElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const isWin = window.ogb?.platform === "win32";
  const drag = isWin ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDrag = isWin ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;
  const patch = (
    p: Partial<
      Pick<
        Bot,
        | "name"
        | "title"
        | "description"
        | "notifications"
        | "computer"
        | "color"
        | "mascotShape"
        | "avatarKind"
        | "modelAvatar"
        | "customMascotShape"
        | "avatarImage"
        | "mascotExpression"
        | "autoApprove"
        | "chiefOfStaff"
        | "voiceProfile"
        | "routingMode"
        | "maxFailovers"
      >
    >,
  ) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const activeState = stateForBot(bot);
  const activeAvatarKind = bot.avatarKind === "model" || (bot.avatarKind == null && isModelAvatar(bot.mascotShape)) ? "model" : "mascot";
  const normalizedMascotShape = normalizeMascotShapeId(bot.customMascotShape ?? (isModelAvatar(bot.mascotShape) ? "cursor" : bot.mascotShape));
  const selectedModelAvatar = isModelAvatar(bot.modelAvatar)
    ? bot.modelAvatar
    : isModelAvatar(bot.mascotShape) ? normalizeMascotShapeId(bot.mascotShape) : "model-openai";
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  const canCoordinate = engine?.capabilities?.agentTools === true;
  const canWorkInCloud = engine?.capabilities?.computerTools === true;
  const currentChief = state.bots.find((candidate) => candidate.chiefOfStaff);

  const readAvatarFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) {
      setAvatarError("请选择 PNG、JPEG 或 WebP 图片");
      return;
    }
    if (file.size > 512 * 1024) {
      setAvatarError("图片不能超过 512 KiB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value) {
        setAvatarError("图片读取失败，请重试");
        return;
      }
      setAvatarError(null);
      patch({ avatarImage: value });
    };
    reader.onerror = () => setAvatarError("图片读取失败，请重试");
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    syncWindowTitleBarColor("panel");
    return () => syncWindowTitleBarColor("app");
  }, []);

  // Keep the settings panel comfortable to use from the keyboard, matching the
  // interaction model of the reference avatar editor: Esc closes, Tab stays in
  // the panel, and opening the panel moves focus to its first control.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      "[href]",
      "[tabindex]:not([tabindex=\"-1\"])",
    ].join(",");
    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.offsetParent !== null,
      );

    const first = focusable()[0];
    if (first && !panel.contains(document.activeElement)) first.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const current = document.activeElement as HTMLElement | null;
      const index = current ? elements.indexOf(current) : -1;
      const next = event.shiftKey
        ? elements[index <= 0 ? elements.length - 1 : index - 1]
        : elements[index < 0 || index === elements.length - 1 ? 0 : index + 1];
      event.preventDefault();
      next.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node)) {
        dispatch({ type: "toggleSettings", open: false });
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
      if (!image) return;
      event.preventDefault();
      readAvatarFile(image.getAsFile() ?? undefined);
    };

    panel.addEventListener("keydown", onKeyDown);
    panel.addEventListener("paste", onPaste);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      panel.removeEventListener("paste", onPaste);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [dispatch]);

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label={zhCN.settings.title}
      tabIndex={-1}
      className="animate-panel-in flex h-full w-full min-w-0 flex-col bg-panel"
    >
      {/* Header */}
      <div
        className={cn("flex min-h-[46px] items-center gap-2 border-b border-hairline/25 px-3", isWin && "pr-[144px]")}
        style={drag}
      >
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: false })}
          className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label="关闭机器人设置"
          style={noDrag}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="whitespace-nowrap text-[15px] font-semibold text-ink">{zhCN.settings.title}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex justify-center py-5">
          <MausAvatar
            color={bot.color}
            image={bot.avatarImage}
            shape={bot.mascotShape}
            state={activeState}
            size={112}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-hairline/40 bg-card">
            <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-2.5">
              <span className="rounded-lg bg-raised px-3 py-1.5 text-[14px] font-medium text-ink">
                {zhCN.settings.bot}
              </span>
              <button
                onClick={() => patch({ color: "green", mascotShape: "cursor", avatarKind: "mascot", customMascotShape: "cursor", mascotExpression: null })}
                className="rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                {zhCN.settings.reset}
              </button>
            </div>

            <div className="p-3">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">自定义图片</div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    readAvatarFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => avatarFileRef.current?.click()}
                  className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                >
                  上传图片
                </button>
                {bot.avatarImage && (
                  <button
                    type="button"
                    onClick={() => { setAvatarError(null); patch({ avatarImage: null }); }}
                    className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                  >
                    清除图片
                  </button>
                )}
                <span className="text-[11px] text-ink-secondary/80">也可直接粘贴图片 · 最大 512 KiB · 选择模型或形态后恢复图标</span>
              </div>
              {avatarError && <p className="mb-3 text-[12px] text-red-400">{avatarError}</p>}
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">头像类型</div>
              <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="头像类型">
                <button onClick={() => patch({ avatarKind: "mascot", mascotShape: normalizedMascotShape, avatarImage: null })} className={cn("rounded-xl bg-inset px-3 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-raised", activeAvatarKind === "mascot" && "ring-2 ring-accent-border text-ink")} aria-pressed={activeAvatarKind === "mascot"}>自定义形态</button>
                <button onClick={() => patch({ avatarKind: "model", mascotShape: selectedModelAvatar, modelAvatar: selectedModelAvatar, avatarImage: null })} className={cn("rounded-xl bg-inset px-3 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-raised", activeAvatarKind === "model" && "ring-2 ring-accent-border text-ink")} aria-pressed={activeAvatarKind === "model"}>模型图标</button>
              </div>
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                {activeAvatarKind === "model" ? "选择模型图标" : zhCN.settings.shape}
              </div>
              <div className="space-y-3">
                {activeAvatarKind === "mascot" && SHAPE_GROUPS.map((group) => (
                  <section key={group.id} aria-label={group.label}>
                    <div className="mb-1.5 text-[11px] font-medium text-ink-secondary">{group.label}</div>
                    <div className={cn("grid gap-2", group.id === "base" ? "grid-cols-4" : "grid-cols-5")}>
                      {MASCOT_SHAPES.filter(({ category }) => category === group.id).map(({ id, label }) => (
                        <button
                          key={`${id}-${activeState}`}
                          onClick={() => patch({ avatarKind: "mascot", mascotShape: id as MausShape, customMascotShape: id as MausShape, avatarImage: null })}
                          className={cn(
                            "flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-xl bg-inset transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border",
                            normalizedMascotShape === id && "ring-2 ring-accent-border",
                          )}
                          title={label}
                          aria-label={`使用${label}形状`}
                          aria-pressed={normalizedMascotShape === id}
                        >
                          {group.id === "base" ? (
                            <ReferenceGrokAvatar color={bot.color} shape={id} size={38} label={label} />
                          ) : (
                            <MausAvatar color={bot.color} shape={id} state={activeState} size={38} animated={false} />
                          )}
                          <span className="text-[10px] leading-none text-ink-secondary">{label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {activeAvatarKind === "model" && <section aria-label="模型图标">
                  <div className="grid grid-cols-4 gap-2">
                    {MODEL_AVATAR_OPTIONS.map(({ id, label }) => (
                      <button
                        key={`${id}-${activeState}`}
                        onClick={() => patch({ avatarKind: "model", mascotShape: id, modelAvatar: id, avatarImage: null })}
                        className={cn(
                          "flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-xl bg-inset transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border",
                          selectedModelAvatar === id && "ring-2 ring-accent-border",
                        )}
                        title={label}
                        aria-label={`使用${label}模型图标`}
                        aria-pressed={selectedModelAvatar === id}
                      >
                        <MausAvatar color={bot.color} shape={id} state={activeState} size={38} animated={false} />
                        <span className="max-w-full truncate px-1 text-[10px] leading-none text-ink-secondary">{label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary/80">原生配色、无边界图标；深浅主题会自动补足必要的对比度。</p>
                </section>}
              </div>

              {activeAvatarKind === "mascot" && <>
                <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                  {zhCN.settings.expression}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {PICKABLE_STATES.map((expression) => (
                    <button
                      key={`${bot.mascotShape ?? "cursor"}-${expression}`}
                      onClick={() => patch({ mascotExpression: expression })}
                      className={cn(
                        "flex h-[58px] items-center justify-center rounded-xl bg-inset transition-colors hover:bg-raised",
                        activeState === expression && "ring-2 ring-accent-border",
                      )}
                      title={expression}
                      aria-label={`Use ${expression} expression`}
                    >
                      <MausAvatar color={bot.color} shape={bot.mascotShape} state={expression} size={42} animated={false} />
                    </button>
                  ))}
                </div>

                <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                  {zhCN.settings.color}
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {MAUS_COLOR_NAMES.map((color) => (
                    <button
                      key={color}
                      onClick={() => patch({ color })}
                      className={cn(
                        "size-8 rounded-full border-2 border-transparent transition-transform hover:scale-110",
                        bot.color === color && "ring-2 ring-accent-border ring-offset-2 ring-offset-card",
                      )}
                      style={{ backgroundColor: MAUS_COLORS[color] }}
                      title={color}
                      aria-label={`Use ${color} mascot color`}
                    />
                  ))}
                </div>

                <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                  {zhCN.settings.motionPreview}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {MAUS_MOTIONS.map((motion) => (
                    <button
                      key={motion}
                      onClick={() => dispatch({ type: "previewMascotMotion", botId: bot.id, kind: motion })}
                      className="rounded-lg bg-inset px-2 py-2 text-[12px] capitalize text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                      aria-label={`Preview ${motion} animation`}
                    >
                      {motion}
                    </button>
                  ))}
                </div>
              </>}
            </div>
          </div>

          <Field label={zhCN.settings.name}>
            <input
              className={inputCls}
              value={bot.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label={zhCN.settings.titleField}>
            <input
              className={inputCls}
              placeholder={zhCN.settings.titlePlaceholder}
              value={bot.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field label={zhCN.settings.description}>
            <textarea
              className={cn(inputCls, "min-h-[96px] resize-none")}
              placeholder={zhCN.settings.descriptionPlaceholder}
              value={bot.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>

          <div
            className={cn(
              "rounded-xl border p-4",
              bot.chiefOfStaff ? "border-accent/40 bg-accent/10" : "border-hairline/40 bg-card",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  bot.chiefOfStaff ? "bg-accent text-white" : "bg-raised text-ink-secondary",
                )}
              >
                <Crown size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium text-ink">{zhCN.settings.chiefOfStaff}</div>
                <div className="text-[11.5px] text-ink-secondary">{zhCN.settings.chiefOfStaffScope}</div>
              </div>
              <button
                role="switch"
                aria-checked={Boolean(bot.chiefOfStaff)}
                aria-label={zhCN.settings.chiefOfStaff}
                disabled={!bot.chiefOfStaff && !canCoordinate}
                onClick={() => patch({ chiefOfStaff: !bot.chiefOfStaff })}
                title={!bot.chiefOfStaff && !canCoordinate ? zhCN.settings.chiefNeedEngine : undefined}
                className={cn(
                  "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  bot.chiefOfStaff ? "bg-accent" : "bg-raised",
                )}
              >
                <span
                  className={cn(
                    "absolute top-[3px] size-5 rounded-full bg-white transition-all",
                    bot.chiefOfStaff ? "left-[21px]" : "left-[3px]",
                  )}
                />
              </button>
            </div>
            <div className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
              {bot.chiefOfStaff && !canCoordinate
                ? zhCN.settings.chiefUnsupported
                : bot.chiefOfStaff
                  ? zhCN.settings.chiefActive
                  : !canCoordinate
                    ? zhCN.settings.chiefNeedEngine
                    : currentChief
                      ? zhCN.settings.chiefHandoff.replace("{name}", currentChief.name)
                      : zhCN.settings.chiefEnable}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">{zhCN.settings.model}</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {zhCN.settings.modelDesc}
              </div>
            </div>
            <ModelPicker bot={bot} />
          </div>

          <div className="rounded-xl bg-card p-4" data-routing-settings>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium text-ink">Agent 智能路由</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
                  当前首选：{engine?.displayName ?? bot.modelSelection.instanceId} · {engine?.models.options.find((option) => option.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-raised px-2 py-1 text-[11px] text-ink-secondary">
                {(bot.routingMode ?? "manual") === "manual" ? "固定模型" : "自动选择"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="路由模式">
              {ROUTING_MODES.map((mode) => (
                <button
                  key={mode.id}
                  role="radio"
                  aria-checked={(bot.routingMode ?? "manual") === mode.id}
                  onClick={() => patch({ routingMode: mode.id })}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-[12px] transition-colors",
                    (bot.routingMode ?? "manual") === mode.id
                      ? "border-accent/50 bg-accent/10 text-ink"
                      : "border-hairline/35 bg-inset text-ink-secondary hover:bg-raised hover:text-ink",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
              {ROUTING_MODES.find((mode) => mode.id === (bot.routingMode ?? "manual"))?.description}
            </p>
            {(bot.routingMode ?? "manual") !== "manual" && (
              <div className="mt-3 flex items-center justify-between border-t border-hairline/30 pt-3">
                <div>
                  <div className="text-[12px] text-ink">最多自动切换</div>
                  <div className="text-[10.5px] text-ink-secondary">工具产生副作用或电脑开始操作后不会重放。</div>
                </div>
                <select
                  aria-label="最大自动切换次数"
                  value={bot.maxFailovers ?? 2}
                  onChange={(event) => patch({ maxFailovers: Number(event.target.value) })}
                  className="rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink outline-none"
                >
                  {[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 次</option>)}
                </select>
              </div>
            )}
            {bot.lastFailover && (
              <div className="mt-3 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-ink-secondary">
                最近自动切换：{bot.lastFailover.from.model} → {bot.lastFailover.to.model} · {ROUTING_ERROR_LABEL[bot.lastFailover.reason] ?? bot.lastFailover.reason}
              </div>
            )}
          </div>

          <BotVoiceSettings bot={bot} />

          <div className="rounded-xl bg-card p-4">
            <div className="text-[15px] font-medium text-ink">{zhCN.settings.computer}</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              {zhCN.settings.computerDesc}{bot.computer ? "" : zhCN.settings.computerAuto}
            </div>
            <div className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary/80">
              {canWorkInCloud ? zhCN.settings.computerShared : zhCN.settings.computerUnsupported}
            </div>
            <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
              {(["cloud", "local", "off"] as const).map((mode, i) => (
                <button
                  key={mode}
                  onClick={() => patch({ computer: mode })}
                  className={cn(
                    "flex-1 py-1.5 text-[13px] capitalize",
                    i > 0 && "border-l border-hairline/40",
                    bot.computer === mode
                      ? "bg-raised text-ink"
                      : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                  )}
                >
                  {mode === "cloud" ? zhCN.settings.computerCloud : mode === "local" ? zhCN.settings.computerLocal : zhCN.settings.computerOff}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">{zhCN.settings.autoMode}</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {bot.autoApprove
                  ? zhCN.settings.autoModeOn
                  : zhCN.settings.autoModeOff}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={Boolean(bot.autoApprove)}
              aria-label={zhCN.settings.autoMode}
              onClick={() => patch({ autoApprove: !bot.autoApprove })}
              className={cn(
                "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                bot.autoApprove ? "bg-accent" : "bg-raised",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] size-5 rounded-full bg-white transition-all",
                  bot.autoApprove ? "left-[21px]" : "left-[3px]",
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">
                {zhCN.settings.notifications}
              </div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {zhCN.settings.notificationsDesc}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={bot.notifications}
              onClick={() => patch({ notifications: !bot.notifications })}
              className={cn(
                "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                bot.notifications ? "bg-accent" : "bg-raised",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] size-5 rounded-full bg-white transition-all",
                  bot.notifications ? "left-[21px]" : "left-[3px]",
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
