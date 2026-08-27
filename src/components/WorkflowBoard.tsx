import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, CircleDashed, GitBranch, Pause, Play, Plus, RotateCcw, Square, XCircle } from "lucide-react";

import { api, useStore, type Bot, type WorkflowNode, type WorkflowRecord } from "@/state/store";
import { cn } from "@/lib/cn";

const workflowLabel: Record<WorkflowRecord["status"], string> = {
  draft: "待启动", running: "执行中", paused: "已暂停", waiting_approval: "等待审批", completed: "已完成", failed: "失败", cancelled: "已取消",
};
const nodeLabel: Record<WorkflowNode["status"], string> = {
  pending: "待执行", waiting_approval: "等待审批", running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消", skipped: "已跳过",
};

export function WorkflowBoard({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [objective, setObjective] = useState("");
  const [steps, setSteps] = useState("");
  const [fact, setFact] = useState("");
  const [notice, setNotice] = useState("");
  const workflows = useMemo(() => Object.values(state.workflows)
    .filter((workflow) => workflow.ownerBotId === bot.id)
    .sort((a, b) => b.updatedAt - a.updatedAt), [state.workflows, bot.id]);
  const workflow = workflows[0];
  const nameOf = (id: string) => state.bots.find((item) => item.id === id)?.name ?? "机器人";
  const update = (value: WorkflowRecord) => dispatch({ type: "workflowPatched", workflow: value });
  const action = async (path: string) => {
    try { const response = await api(path, { method: "POST" }); if (response.workflow) update(response.workflow); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "操作失败"); }
  };
  const create = async () => {
    const lines = steps.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12);
    if (!objective.trim() || !lines.length) return setNotice("请填写目标，并至少添加一个节点");
    const agents = state.bots.filter((item) => !item.hidden);
    const nodes: Array<{ id: string; title: string; prompt: string; botId: string; dependsOn: string[]; requiresComputer: boolean; approval: boolean; maxRetries: number }> = lines.map((line, index) => {
      const requiresComputer = /^\[电脑\]/.test(line);
      const approval = /^\[审批\]/.test(line);
      const title = line.replace(/^\[(?:电脑|审批)\]\s*/, "");
      return { id: `step-${index + 1}`, title, prompt: title, botId: (agents[index % agents.length] ?? bot).id, dependsOn: [], requiresComputer, approval, maxRetries: 1 };
    });
    if (nodes.length > 1) nodes.push({ id: "summary", title: "汇总最终结果", prompt: "汇总所有依赖节点的结果，检查遗漏并给出最终答复。", botId: bot.id, dependsOn: nodes.map((node) => node.id), requiresComputer: false, approval: false, maxRetries: 1 });
    try {
      const created = await api("/api/workflows", { method: "POST", body: JSON.stringify({ name: objective.slice(0, 48), ownerBotId: bot.id, objective, maxConcurrency: 4, nodes }) });
      update(created.workflow); await action(`/api/workflows/${created.workflow.id}/run`);
      setCreating(false); setObjective(""); setSteps(""); setOpen(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "创建失败"); }
  };
  const addFact = async () => {
    if (!workflow || !fact.trim()) return;
    try {
      const response = await api(`/api/workflows/${workflow.id}`, { method: "PATCH", body: JSON.stringify({ space: { facts: [...workflow.space.facts, fact.trim()] } }) });
      update(response.workflow); setFact("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "更新共享空间失败"); }
  };

  return <div className="mx-auto w-full max-w-[900px] px-5 pt-1">
    <div className="rounded-xl border border-hairline/35 bg-panel/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12.5px] text-ink-secondary hover:text-ink">
          <GitBranch size={14} /><span className="font-medium text-ink">任务看板</span>
          {workflow && <span className={cn(workflow.status === "failed" ? "text-danger" : workflow.status === "completed" ? "text-success" : "text-accent")}>· {workflowLabel[workflow.status]}</span>}
          <ChevronDown size={14} className={cn("ml-auto transition-transform", open && "rotate-180")} />
        </button>
        <button type="button" onClick={() => { setCreating((value) => !value); setOpen(true); }} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" title="新建任务图"><Plus size={14} /></button>
      </div>
      {open && <div className="border-t border-hairline/30 px-3 pb-3 pt-2">
        {creating && <div className="mb-3 space-y-2 rounded-lg border border-accent/20 bg-accent/5 p-2.5">
          <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="工作流总目标" className="w-full rounded-md border border-hairline/40 bg-app px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
          <textarea value={steps} onChange={(event) => setSteps(event.target.value)} rows={4} placeholder={"每行一个并行子任务\n[电脑] 浏览并采集数据\n[审批] 发布最终结果"} className="w-full resize-y rounded-md border border-hairline/40 bg-app px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent" />
          <div className="flex items-center justify-between gap-2"><span className="text-[10.5px] text-ink-secondary">节点自动分配给可见机器人，多个节点完成后由当前机器人汇总。</span><button onClick={() => void create()} className="shrink-0 rounded-full bg-accent px-3 py-1 text-[11.5px] text-white">创建并运行</button></div>
        </div>}
        {workflow ? <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{workflow.name}</span>
            {workflow.status === "running" && <button onClick={() => void action(`/api/workflows/${workflow.id}/pause`)} className="flex items-center gap-1 rounded-full border border-hairline/50 px-2 py-0.5 text-[10.5px] text-ink-secondary hover:bg-raised"><Pause size={11} />暂停</button>}
            {["draft", "paused", "failed", "waiting_approval"].includes(workflow.status) && <button onClick={() => void action(`/api/workflows/${workflow.id}/${workflow.status === "draft" ? "run" : "resume"}`)} className="flex items-center gap-1 rounded-full border border-hairline/50 px-2 py-0.5 text-[10.5px] text-ink-secondary hover:bg-raised"><Play size={11} />{workflow.status === "draft" ? "运行" : "恢复"}</button>}
            {!['completed', 'cancelled'].includes(workflow.status) && <button onClick={() => void action(`/api/workflows/${workflow.id}/cancel`)} className="flex items-center gap-1 rounded-full border border-danger/30 px-2 py-0.5 text-[10.5px] text-danger hover:bg-danger/10"><Square size={10} />取消</button>}
          </div>
          <div className="mb-2 text-[11.5px] text-ink-secondary">{workflow.space.objective}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {workflow.nodes.map((node) => <div key={node.id} className={cn("rounded-lg border p-2", node.status === "failed" ? "border-danger/30 bg-danger/5" : node.status === "completed" ? "border-success/25 bg-success/5" : "border-hairline/35 bg-app/60")}>
              <div className="flex items-start gap-1.5">
                {node.status === "completed" ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" /> : node.status === "failed" ? <XCircle size={13} className="mt-0.5 shrink-0 text-danger" /> : <CircleDashed size={13} className={cn("mt-0.5 shrink-0 text-accent", node.status === "running" && "animate-spin")} />}
                <div className="min-w-0 flex-1"><div className="truncate text-[11.5px] font-medium text-ink">{node.title}</div><div className="mt-0.5 flex flex-wrap gap-1 text-[10.5px] text-ink-secondary"><span>{nameOf(node.botId)}</span><span>· {nodeLabel[node.status]}</span><span>· {node.attempts} 次</span>{node.requiresComputer && <span>· 电脑</span>}</div></div>
              </div>
              {node.result && <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-secondary">{node.result}</p>}
              {node.status === "waiting_approval" && <button onClick={() => void action(`/api/workflows/${workflow.id}/nodes/${node.id}/approve`)} className="mt-1.5 rounded-full border border-accent/30 px-2 py-0.5 text-[10.5px] text-accent">批准执行</button>}
              {node.status === "failed" && node.replaySafe !== false && <button onClick={() => void action(`/api/workflows/${workflow.id}/nodes/${node.id}/retry`)} className="mt-1.5 flex items-center gap-1 rounded-full border border-hairline/50 px-2 py-0.5 text-[10.5px] text-ink-secondary"><RotateCcw size={10} />重跑节点</button>}
            </div>)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-secondary"><span>事实 {workflow.space.facts.length}</span><span>假设 {workflow.space.hypotheses.length}</span><span>决策 {workflow.space.decisions.length}</span><span>成果 {workflow.space.artifacts.length}</span><span>来源 {workflow.space.sources.length}</span><span className="ml-auto flex min-w-[180px] flex-1 items-center gap-1 sm:max-w-[300px]"><input value={fact} onChange={(event) => setFact(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addFact(); }} placeholder="向共享空间添加已确认事实" className="min-w-0 flex-1 rounded-md border border-hairline/40 bg-app px-2 py-1 text-[10.5px] text-ink outline-none focus:border-accent" /><button onClick={() => void addFact()} className="rounded-md border border-hairline/40 px-1.5 py-1 hover:bg-raised">添加</button></span></div>
        </> : !creating && <div className="py-2 text-center text-[11.5px] text-ink-secondary">还没有任务图，点击右上角“＋”快速创建。</div>}
        {notice && <div className="mt-2 text-[11px] text-danger">{notice}</div>}
      </div>}
    </div>
  </div>;
}
