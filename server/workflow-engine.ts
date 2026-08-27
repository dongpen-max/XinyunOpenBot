import { existsSync, readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";
import { newId, type ProviderErrorCode } from "./contracts.ts";

export type WorkflowStatus = "draft" | "running" | "paused" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type WorkflowNodeStatus = "pending" | "waiting_approval" | "running" | "completed" | "failed" | "cancelled" | "skipped";
export type WorkflowRunIf = "all_success" | "any_failed" | "always";

export interface WorkflowNode {
  id: string;
  title: string;
  prompt: string;
  botId: string;
  dependsOn: string[];
  runIf: WorkflowRunIf;
  requiresComputer: boolean;
  approval: boolean;
  status: WorkflowNodeStatus;
  attempts: number;
  maxRetries: number;
  traceId?: string;
  startedAt?: number;
  finishedAt?: number;
  errorCode?: ProviderErrorCode;
  resultMessageId?: string;
  result?: string;
  replaySafe?: boolean;
}

export interface SharedTaskSpace {
  objective: string;
  facts: string[];
  hypotheses: string[];
  decisions: string[];
  artifacts: Array<{ name: string; path?: string; nodeId?: string }>;
  sources: Array<{ title: string; url?: string; nodeId?: string }>;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  ownerBotId: string;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  maxConcurrency: number;
  nodes: WorkflowNode[];
  space: SharedTaskSpace;
}

export interface WorkflowNodeResult {
  ok: boolean;
  traceId?: string;
  errorCode?: ProviderErrorCode;
  resultMessageId?: string;
  result?: string;
  retryable?: boolean;
  replaySafe?: boolean;
}

export type WorkflowExecutor = (workflow: WorkflowRecord, node: WorkflowNode) => Promise<WorkflowNodeResult>;
export type WorkflowListener = (workflow: WorkflowRecord) => void;

const terminalNode = (status: WorkflowNodeStatus) => ["completed", "failed", "cancelled", "skipped"].includes(status);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function validateWorkflowNodes(nodes: Array<Pick<WorkflowNode, "id" | "dependsOn">>): string | null {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) return "节点 ID 必须唯一";
    ids.add(node.id);
  }
  for (const node of nodes) if (node.dependsOn.some((id) => !ids.has(id) || id === node.id)) return "节点依赖不存在或指向自身";
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) if (!visit(dep)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  return nodes.every((node) => visit(node.id)) ? null : "任务图不能包含循环依赖";
}

export class WorkflowEngine {
  private workflows = new Map<string, WorkflowRecord>();
  private active = new Set<string>();
  private readonly file: string;
  private readonly execute: WorkflowExecutor;
  private readonly onChange: WorkflowListener;
  constructor(
    file: string,
    execute: WorkflowExecutor,
    onChange: WorkflowListener = () => {},
  ) {
    this.file = file; this.execute = execute; this.onChange = onChange;
    this.load();
    queueMicrotask(() => this.pump());
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const records = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(records)) return;
      for (const record of records as WorkflowRecord[]) {
        if (!record?.id || !Array.isArray(record.nodes)) continue;
        for (const node of record.nodes) if (node.status === "running") node.status = "pending";
        record.updatedAt = Date.now();
        this.workflows.set(record.id, record);
      }
      this.persist();
    } catch { /* a damaged workflow file never blocks the main app */ }
  }
  private persist() { writeFileAtomic(this.file, JSON.stringify([...this.workflows.values()], null, 2)); }
  private changed(workflow: WorkflowRecord) { workflow.updatedAt = Date.now(); this.persist(); this.onChange(clone(workflow)); }

  list(ownerBotId?: string) {
    return [...this.workflows.values()].filter((item) => !ownerBotId || item.ownerBotId === ownerBotId)
      .sort((a, b) => b.updatedAt - a.updatedAt).map(clone);
  }
  get(id: string) { const item = this.workflows.get(id); return item ? clone(item) : null; }

  create(input: {
    name: string; ownerBotId: string; objective: string; maxConcurrency?: number;
    nodes: Array<Partial<WorkflowNode> & Pick<WorkflowNode, "title" | "prompt" | "botId">>;
  }) {
    const ids = new Set<string>();
    const nodes: WorkflowNode[] = input.nodes.map((node) => {
      let id = String(node.id ?? "").trim() || newId();
      while (ids.has(id)) id = newId();
      ids.add(id);
      return {
        id, title: node.title.trim().slice(0, 120), prompt: node.prompt.trim().slice(0, 20_000), botId: node.botId,
        dependsOn: [...new Set(node.dependsOn ?? [])], runIf: node.runIf ?? "all_success",
        requiresComputer: node.requiresComputer === true, approval: node.approval === true,
        status: "pending", attempts: 0, maxRetries: Math.max(0, Math.min(3, Number(node.maxRetries ?? 1))),
      };
    });
    const invalid = validateWorkflowNodes(nodes);
    if (invalid) throw Object.assign(new Error(invalid), { status: 400 });
    if (!nodes.length || nodes.some((node) => !node.title || !node.prompt || !node.botId)) {
      throw Object.assign(new Error("工作流至少需要一个完整节点"), { status: 400 });
    }
    const now = Date.now();
    const workflow: WorkflowRecord = {
      id: newId(), name: input.name.trim().slice(0, 100) || "新任务图", ownerBotId: input.ownerBotId,
      status: "draft", createdAt: now, updatedAt: now, maxConcurrency: Math.max(1, Math.min(6, Number(input.maxConcurrency ?? 4))), nodes,
      space: { objective: input.objective.trim().slice(0, 20_000), facts: [], hypotheses: [], decisions: [], artifacts: [], sources: [] },
    };
    this.workflows.set(workflow.id, workflow); this.changed(workflow); return clone(workflow);
  }

  patchSpace(id: string, patch: Partial<SharedTaskSpace>) {
    const workflow = this.workflows.get(id); if (!workflow) return null;
    workflow.space = {
      objective: typeof patch.objective === "string" ? patch.objective.slice(0, 20_000) : workflow.space.objective,
      facts: Array.isArray(patch.facts) ? patch.facts.map(String).slice(0, 100) : workflow.space.facts,
      hypotheses: Array.isArray(patch.hypotheses) ? patch.hypotheses.map(String).slice(0, 100) : workflow.space.hypotheses,
      decisions: Array.isArray(patch.decisions) ? patch.decisions.map(String).slice(0, 100) : workflow.space.decisions,
      artifacts: Array.isArray(patch.artifacts) ? patch.artifacts.slice(0, 100) : workflow.space.artifacts,
      sources: Array.isArray(patch.sources) ? patch.sources.slice(0, 100) : workflow.space.sources,
    };
    this.changed(workflow); return clone(workflow);
  }

  run(id: string) {
    const workflow = this.workflows.get(id); if (!workflow) return null;
    if (["completed", "cancelled"].includes(workflow.status)) return clone(workflow);
    workflow.status = "running"; workflow.startedAt ??= Date.now(); workflow.finishedAt = undefined;
    this.changed(workflow); this.pump(); return clone(workflow);
  }
  pause(id: string) { const w = this.workflows.get(id); if (!w) return null; if (w.status === "running") { w.status = "paused"; this.changed(w); } return clone(w); }
  resume(id: string) {
    const w = this.workflows.get(id); if (!w) return null;
    if (["paused", "failed", "waiting_approval"].includes(w.status)) {
      if (w.status === "failed") {
        for (const node of w.nodes) {
          if (node.status === "failed" && node.replaySafe !== false) {
            node.status = "pending"; node.errorCode = undefined; node.finishedAt = undefined; node.result = undefined; node.resultMessageId = undefined;
          } else if (node.status === "skipped") node.status = "pending";
        }
      }
      w.status = "running"; w.finishedAt = undefined; this.changed(w); this.pump();
    }
    return clone(w);
  }
  cancel(id: string) {
    const w = this.workflows.get(id); if (!w) return null; w.status = "cancelled"; w.finishedAt = Date.now();
    for (const n of w.nodes) if (n.status === "pending" || n.status === "waiting_approval") n.status = "cancelled";
    this.changed(w); return clone(w);
  }
  approve(id: string, nodeId: string) {
    const w = this.workflows.get(id); const n = w?.nodes.find((item) => item.id === nodeId);
    if (!w || !n || n.status !== "waiting_approval") return null;
    n.approval = false; n.status = "pending"; w.status = "running"; this.changed(w); this.pump(); return clone(w);
  }
  retry(id: string, nodeId: string) {
    const w = this.workflows.get(id); const n = w?.nodes.find((item) => item.id === nodeId);
    if (!w || !n || n.status !== "failed" || n.replaySafe === false) return null;
    n.status = "pending"; n.errorCode = undefined; n.finishedAt = undefined; n.result = undefined; n.resultMessageId = undefined;
    for (const child of w.nodes) if (child.dependsOn.includes(n.id) && child.status === "skipped") child.status = "pending";
    w.status = "running"; w.finishedAt = undefined; this.changed(w); this.pump(); return clone(w);
  }

  private dependencyDecision(workflow: WorkflowRecord, node: WorkflowNode): "wait" | "run" | "skip" {
    const deps = node.dependsOn.map((id) => workflow.nodes.find((item) => item.id === id)!);
    if (!deps.every((dep) => terminalNode(dep.status))) return "wait";
    if (!deps.length) return "run";
    const failures = deps.some((dep) => dep.status !== "completed");
    if (node.runIf === "always") return "run";
    if (node.runIf === "any_failed") return failures ? "run" : "skip";
    return failures ? "skip" : "run";
  }
  private settleWorkflow(workflow: WorkflowRecord) {
    if (workflow.status === "cancelled" || workflow.status === "paused") return;
    const unfinished = workflow.nodes.some((node) => !terminalNode(node.status));
    if (unfinished) {
      if (workflow.nodes.some((node) => node.status === "waiting_approval") && !workflow.nodes.some((node) => node.status === "running")) workflow.status = "waiting_approval";
      return;
    }
    workflow.finishedAt = Date.now(); workflow.status = workflow.nodes.some((node) => node.status === "failed") ? "failed" : "completed";
  }
  private pump() {
    for (const workflow of this.workflows.values()) {
      if (workflow.status !== "running") continue;
      let active = workflow.nodes.filter((node) => node.status === "running").length;
      let changed = false;
      for (const node of workflow.nodes) {
        if (node.status !== "pending") continue;
        const decision = this.dependencyDecision(workflow, node);
        if (decision === "wait") continue;
        if (decision === "skip") { node.status = "skipped"; node.finishedAt = Date.now(); changed = true; continue; }
        if (node.approval) { node.status = "waiting_approval"; changed = true; continue; }
        if (active >= workflow.maxConcurrency) break;
        active++; changed = true; this.startNode(workflow, node);
      }
      this.settleWorkflow(workflow);
      if (changed || ["completed", "failed", "waiting_approval"].includes(workflow.status)) this.changed(workflow);
    }
  }
  private startNode(workflow: WorkflowRecord, node: WorkflowNode) {
    const key = `${workflow.id}:${node.id}`; if (this.active.has(key)) return;
    this.active.add(key); node.status = "running"; node.startedAt = Date.now(); node.finishedAt = undefined; node.attempts++;
    void this.execute(clone(workflow), clone(node)).then((result) => {
      const current = this.workflows.get(workflow.id)?.nodes.find((item) => item.id === node.id);
      if (!current) return;
      current.traceId = result.traceId; current.resultMessageId = result.resultMessageId; current.result = result.result?.slice(0, 4_000);
      current.errorCode = result.errorCode; current.replaySafe = result.replaySafe ?? true;
      if (this.workflows.get(workflow.id)?.status === "cancelled") current.status = "cancelled";
      else if (result.ok) {
        current.status = "completed";
        const owner = this.workflows.get(workflow.id)!;
        if (!owner.space.artifacts.some((item) => item.nodeId === current.id)) owner.space.artifacts.push({ name: `${current.title} 输出`, nodeId: current.id });
        for (const rawUrl of result.result?.match(/https?:\/\/[^\s)\]}]+/g) ?? []) {
          let url = rawUrl;
          try { const parsed = new URL(rawUrl); parsed.search = ""; parsed.hash = ""; url = parsed.toString(); } catch { continue; }
          if (!owner.space.sources.some((item) => item.url === url)) owner.space.sources.push({ title: url, url, nodeId: current.id });
        }
      }
      else if (result.retryable && current.replaySafe !== false && current.attempts <= current.maxRetries) current.status = "pending";
      else current.status = "failed";
      current.finishedAt = current.status === "pending" ? undefined : Date.now();
    }).catch(() => {
      const current = this.workflows.get(workflow.id)?.nodes.find((item) => item.id === node.id);
      if (current) { current.status = "failed"; current.errorCode = "unknown"; current.replaySafe = true; current.finishedAt = Date.now(); }
    }).finally(() => {
      this.active.delete(key); const current = this.workflows.get(workflow.id); if (current) { this.settleWorkflow(current); this.changed(current); this.pump(); }
    });
  }
}
