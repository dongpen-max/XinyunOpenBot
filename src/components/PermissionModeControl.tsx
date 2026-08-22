import { useEffect, useRef, useState } from "react";
import { Check, ChevronUp, ShieldCheck } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";

/** The composer-level permission switch. It mirrors the bot setting, but is
 * placed where a user decides how the current computer/tool session should
 * behave. Ask mode keeps the provider approval card; auto mode is intended
 * for trusted tasks and lets the provider run its mounted tools directly. */
export function PermissionModeControl({ bot, disabled = false }: { bot?: Bot; disabled?: boolean }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const automatic = Boolean(bot?.autoApprove);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!bot) return null;

  const choose = (value: boolean) => {
    dispatch({ type: "updateBot", botId: bot.id, patch: { autoApprove: value } });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="工具权限模式"
        title={automatic ? "自动允许工具操作" : "每次询问工具权限"}
        className={cn(
          "flex h-8 items-center gap-1 rounded-full px-2 text-[11.5px] transition-colors",
          automatic
            ? "bg-accent/15 text-accent hover:bg-accent/25"
            : "text-ink-secondary hover:bg-raised hover:text-ink",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <ShieldCheck size={14} />
        <span>{automatic ? "自动允许" : "每次询问"}</span>
        <ChevronUp size={12} className={cn("transition-transform", open ? "rotate-180" : "rotate-0")} />
      </button>
      {open && (
        <div role="menu" aria-label="工具权限模式" className="absolute bottom-full right-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/50 bg-panel p-1.5 shadow-xl">
          <div className="px-2.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-secondary">工具权限</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!automatic}
            onClick={() => choose(false)}
            className={cn("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-raised", !automatic && "bg-raised")}
          >
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between text-[13px] font-medium text-ink">每次询问 {!automatic && <Check size={14} className="text-accent" />}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-secondary">执行电脑、文件和 MCP 工具前先确认。</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={automatic}
            onClick={() => choose(true)}
            className={cn("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-raised", automatic && "bg-raised")}
          >
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between text-[13px] font-medium text-ink">自动允许安全操作 {automatic && <Check size={14} className="text-accent" />}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-secondary">可信任务可直接执行电脑、文件和 MCP 工具，不再逐次弹出确认。</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
