import { Check, CircleAlert, CircleDashed, Copy, ExternalLink, MonitorCheck, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { engineHealth, type EngineHealthTone } from "@/lib/engine-health";
import type { InstanceInfo } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";

const toneClass: Record<EngineHealthTone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  neutral: "bg-raised text-ink-secondary",
};

function StatusIcon({ tone }: { tone: EngineHealthTone }) {
  if (tone === "success") return <Check size={12} />;
  if (tone === "danger" || tone === "warning") return <CircleAlert size={12} />;
  return <CircleDashed size={12} />;
}

export function EngineHealthRow({ instance, compact = false }: { instance: InstanceInfo; compact?: boolean }) {
  const health = engineHealth(instance);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!health.command) return;
    await navigator.clipboard.writeText(health.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn("min-w-0", !compact && "rounded-xl border border-hairline/40 bg-card p-3.5")}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset">
          <ProviderMark driverKind={instance.driverKind} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">{instance.displayName}</div>
          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-secondary">{health.detail}</div>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px]", toneClass[health.tone])}>
          <StatusIcon tone={health.tone} />
          {health.label}
        </span>
      </div>
      {instance.snapshot.state === "available" && (
        <div className="mt-2 flex items-center gap-1.5 pl-[42px] text-[10.5px] text-ink-secondary">
          <MonitorCheck size={12} className={instance.capabilities?.computerTools ? "text-success" : "text-ink-secondary/60"} />
          {instance.capabilities?.computerTools ? "支持云端电脑与工具操作" : "当前驱动仅用于对话/编程，不接管云端电脑"}
        </div>
      )}
      {health.command && !compact && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-inset px-2.5 py-1.5 font-mono text-[11px] text-ink-secondary">
            {health.command}
          </code>
          <button onClick={copy} className="shrink-0 rounded-lg bg-raised p-2 text-ink-secondary hover:text-ink" title="复制命令">
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          </button>
          {instance.install?.docsUrl && (
            <a href={instance.install.docsUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-raised p-2 text-ink-secondary hover:text-ink" title="打开安装文档">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function EngineRefreshButton({ onRefresh, busy }: { onRefresh: () => void; busy: boolean }) {
  return (
    <button
      onClick={onRefresh}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-raised-hover hover:text-ink disabled:opacity-50"
    >
      <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
      {busy ? "检查中…" : "重新检查"}
    </button>
  );
}
