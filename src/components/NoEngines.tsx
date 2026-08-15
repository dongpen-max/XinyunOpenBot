import { useState } from "react";
import { useStore, type InstanceInfo } from "@/state/store";
import { EngineHealthRow, EngineRefreshButton } from "./EngineHealth";

export function NoEngines() {
  const { state, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recheck = async () => {
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
  const engines = state.instances.filter((i) => i.install) as InstanceInfo[];
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-app">
      <div className="mx-auto w-full max-w-[560px] px-6 py-12">
        <h1 className="text-[20px] font-semibold text-ink">让机器人连接一个 AI 引擎</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">XinyunOpen Bot 可使用本机 CLI、API 中转站或云端 Computer 引擎。完成任意一种配置后即可开始工作。</p>
        <div className="mt-6 flex flex-col gap-2.5">
          {engines.map((instance) => <EngineHealthRow key={instance.instanceId} instance={instance} />)}
        </div>
        {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">检查失败：{error}</div>}
        <div className="mt-6"><EngineRefreshButton onRefresh={() => void recheck()} busy={checking} /></div>
      </div>
    </main>
  );
}
