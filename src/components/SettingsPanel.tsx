import { ChevronLeft, Crown } from "lucide-react";
import { useEffect } from "react";
import { useStore, type Bot } from "@/state/store";
import { MASCOT_SHAPES, MausAvatar, type MausShape } from "./Avatar";
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
        | "mascotExpression"
        | "autoApprove"
        | "chiefOfStaff"
        | "voiceProfile"
      >
    >,
  ) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const activeState = stateForBot(bot);
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  const canCoordinate = engine?.capabilities?.agentTools === true;
  const canWorkInCloud = engine?.capabilities?.computerTools === true;
  const currentChief = state.bots.find((candidate) => candidate.chiefOfStaff);

  useEffect(() => {
    syncWindowTitleBarColor("panel");
    return () => syncWindowTitleBarColor("app");
  }, []);

  return (
    <aside className="animate-panel-in flex h-full w-full min-w-0 flex-col bg-panel">
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
                onClick={() => patch({ color: "green", mascotShape: "cursor", mascotExpression: null })}
                className="rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                {zhCN.settings.reset}
              </button>
            </div>

            <div className="p-3">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                {zhCN.settings.shape}
              </div>
              <div className="space-y-3">
                {SHAPE_GROUPS.map((group) => (
                  <section key={group.id} aria-label={group.label}>
                    <div className="mb-1.5 text-[11px] font-medium text-ink-secondary">{group.label}</div>
                    <div className="grid grid-cols-5 gap-2">
                      {MASCOT_SHAPES.filter(({ category }) => category === group.id).map(({ id, label }) => (
                        <button
                          key={`${id}-${activeState}`}
                          onClick={() => patch({ mascotShape: id as MausShape })}
                          className={cn(
                            "flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-xl bg-inset transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border",
                            (bot.mascotShape ?? "cursor") === id && "ring-2 ring-accent-border",
                          )}
                          title={label}
                          aria-label={`使用${label}形状`}
                          aria-pressed={(bot.mascotShape ?? "cursor") === id}
                        >
                          <MausAvatar color={bot.color} shape={id} state={activeState} size={38} animated={false} />
                          <span className="text-[10px] leading-none text-ink-secondary">{label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

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
                    <MausAvatar
                      color={bot.color}
                      shape={bot.mascotShape}
                      state={expression}
                      size={42}
                      animated={false}
                    />
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
