import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useStore, type InstanceInfo } from "@/state/store";
import { EngineSetup } from "./EngineSetup";

export function NoEngines() {
  const { state } = useStore();
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/instances");
      const data = await res.json();
      // trigger the existing SSE-independent hydration path by reloading;
      // this is intentionally small and works in browser + Electron.
      if (Array.isArray(data.instances)) window.location.reload();
    } finally {
      setChecking(false);
    }
  };
  const engines = state.instances.filter((i) => i.install) as InstanceInfo[];
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-app">
      <div className="mx-auto w-full max-w-[560px] px-6 py-12">
        <h1 className="text-[20px] font-semibold text-ink">先安装一个 AI 引擎</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">XinyunOpen Bot 不内置模型，机器人通过本机已登录的 AI CLI 工作。选择任意一个引擎即可开始。</p>
        <div className="mt-6 flex flex-col gap-2.5">
          {engines.map((instance) => <div key={instance.instanceId} className="rounded-xl border border-hairline/40 bg-card p-3.5"><div className="text-[14px] font-medium text-ink">{instance.displayName}</div><EngineSetup instance={instance} /></div>)}
        </div>
        <button onClick={recheck} disabled={checking} className="mt-6 flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-60">
          {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {checking ? "检查中…" : "重新检查"}
        </button>
      </div>
    </main>
  );
}
