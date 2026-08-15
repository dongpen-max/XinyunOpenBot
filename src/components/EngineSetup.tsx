import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { InstanceInfo } from "@/state/store";

type Platform = "darwin" | "win32" | "linux";

function hostPlatform(): Platform {
  const p = window.ogb?.platform;
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  const ua = navigator.userAgent;
  return ua.includes("Mac") ? "darwin" : ua.includes("Win") ? "win32" : "linux";
}

export function EngineSetup({ instance }: { instance: InstanceInfo }) {
  const [copied, setCopied] = useState(false);
  const install = instance.install;
  const command = install?.command?.[hostPlatform()];
  const signInOnly = instance.snapshot.state === "available" && instance.snapshot.authenticated === false;
  if (!install) return <div className="text-[12px] text-ink-secondary">{instance.snapshot.reason ?? "当前不可用"}</div>;
  const shown = signInOnly ? install.signInCommand : command;
  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  return (
    <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
      <div>{signInOnly ? `${instance.displayName} 已安装，但尚未登录。请在终端执行：` : `${instance.displayName} 尚未就绪。`}</div>
      {shown && (
        <div className="mt-1 flex items-center gap-1.5">
          <code className="min-w-0 flex-1 overflow-x-auto rounded bg-app px-2 py-1 font-mono text-[11px]">{shown}</code>
          <button onClick={copy} className="shrink-0 rounded bg-raised p-1.5 text-ink-secondary hover:text-ink" title="复制命令">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      )}
      {install.docsUrl && (
        <a href={install.docsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-accent hover:underline">
          <ExternalLink size={11} /> 安装文档
        </a>
      )}
    </div>
  );
}
