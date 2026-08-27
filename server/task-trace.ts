/**
 * Durable, deliberately small execution traces.  This is not a transcript:
 * it records only operational metadata that is safe to export for diagnosis.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { newId, type ModelSelection, type ProviderErrorCode, type RuntimeEvent } from "./contracts.ts";
import { classifyProviderError, redactProviderText } from "./provider-errors.ts";

export type TraceStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TraceEventKind = "queued" | "running" | "attempt" | "tool" | "handoff" | "failover" | "computer" | "completed" | "failed" | "cancelled";
export interface TraceEvent {
  id: string;
  at: number;
  kind: TraceEventKind;
  label: string;
  ok?: boolean;
  durationMs?: number;
  model?: ModelSelection;
  from?: ModelSelection;
  to?: ModelSelection;
  errorCode?: ProviderErrorCode;
}
export interface TaskTrace {
  id: string;
  threadId: string;
  botId: string;
  userMessageId?: string;
  rootTurnId?: string;
  status: TraceStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  queueWaitMs?: number;
  durationMs?: number;
  usage?: { input: number; output: number };
  cost?: number;
  attempts: ModelSelection[];
  failovers: number;
  hasExternalSideEffect: boolean;
  hasComputerAction: boolean;
  errorCode?: ProviderErrorCode;
  events: TraceEvent[];
}

const MAX_TRACES = 300;
const MAX_EVENTS = 120;
const safeLabel = (value: string, fallback: string) => redactProviderText(value || fallback).slice(0, 160) || fallback;
const terminal = (status: TraceStatus) => status === "completed" || status === "failed" || status === "cancelled";

export class TaskTraceStore {
  private traces = new Map<string, TaskTrace>();
  private readonly dir: string;
  constructor(dir: string) { this.dir = dir; this.load(); }

  private file(id: string) { return join(this.dir, `${id}.json`); }
  private load() {
    mkdirSync(this.dir, { recursive: true });
    for (const file of readdirSync(this.dir).filter((name) => name.endsWith(".json")).slice(-MAX_TRACES)) {
      try {
        const trace = JSON.parse(readFileSync(join(this.dir, file), "utf8")) as TaskTrace;
        if (trace?.id && trace.threadId && trace.botId && Array.isArray(trace.events)) {
          // A process restart must not leave an immortal 'running' record.
          if (!terminal(trace.status)) {
            trace.status = "failed";
            trace.finishedAt = Date.now();
            trace.durationMs = trace.startedAt ? trace.finishedAt - trace.startedAt : undefined;
            trace.errorCode = "connection_lost";
            trace.events.push(this.event("failed", "应用重启，运行未恢复", { errorCode: "connection_lost", ok: false }));
          }
          this.traces.set(trace.id, trace);
          this.persist(trace);
        }
      } catch { /* corrupt diagnostics never stop the app */ }
    }
    this.prune();
  }
  private event(kind: TraceEventKind, label: string, extra: Omit<TraceEvent, "id" | "at" | "kind" | "label"> = {}): TraceEvent {
    return { id: newId(), at: Date.now(), kind, label: safeLabel(label, kind), ...extra };
  }
  private persist(trace: TaskTrace) { writeFileAtomic(this.file(trace.id), JSON.stringify(trace)); }
  private mutate(id: string, change: (trace: TaskTrace) => void): TaskTrace | null {
    const trace = this.traces.get(id);
    if (!trace) return null;
    change(trace);
    if (trace.events.length > MAX_EVENTS) trace.events.splice(0, trace.events.length - MAX_EVENTS);
    this.persist(trace);
    return trace;
  }
  private prune() {
    const old = [...this.traces.values()].sort((a, b) => b.createdAt - a.createdAt).slice(MAX_TRACES);
    for (const trace of old) {
      this.traces.delete(trace.id);
      try { if (existsSync(this.file(trace.id))) unlinkSync(this.file(trace.id)); } catch { /* best effort */ }
    }
  }
  create(input: { threadId: string; botId: string; userMessageId?: string }): TaskTrace {
    const now = Date.now();
    const trace: TaskTrace = {
      id: newId(), threadId: input.threadId, botId: input.botId, userMessageId: input.userMessageId,
      status: "queued", createdAt: now, attempts: [], failovers: 0, hasExternalSideEffect: false, hasComputerAction: false,
      events: [this.event("queued", "已进入机器人队列")],
    };
    this.traces.set(trace.id, trace); this.persist(trace); this.prune(); return trace;
  }
  get(id: string) { return this.traces.get(id) ?? null; }
  findByRootTurn(rootTurnId: string) { return [...this.traces.values()].find((trace) => trace.rootTurnId === rootTurnId) ?? null; }
  list(threadId?: string, limit = 30) {
    return [...this.traces.values()].filter((trace) => !threadId || trace.threadId === threadId)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(limit, 100)));
  }
  start(id: string, rootTurnId?: string) { return this.mutate(id, (t) => { if (!t.startedAt) { t.startedAt = Date.now(); t.queueWaitMs = t.startedAt - t.createdAt; } t.rootTurnId ??= rootTurnId; t.status = "running"; t.events.push(this.event("running", "开始执行", { durationMs: t.queueWaitMs })); }); }
  attempt(id: string, model: ModelSelection) { return this.mutate(id, (t) => { t.attempts.push(model); t.events.push(this.event("attempt", "尝试模型", { model })); }); }
  failover(id: string, from: ModelSelection, to: ModelSelection, errorCode: ProviderErrorCode) { return this.mutate(id, (t) => { t.failovers++; t.events.push(this.event("failover", "自动切换模型", { from, to, errorCode })); }); }
  tool(id: string, name: string, ok?: boolean, durationMs?: number) { return this.mutate(id, (t) => { t.hasExternalSideEffect = true; t.events.push(this.event("tool", safeLabel(name, "工具调用"), { ok, durationMs })); }); }
  computer(id: string, label: string, durationMs?: number) { return this.mutate(id, (t) => { t.hasComputerAction = true; t.events.push(this.event("computer", label, { durationMs })); }); }
  handoff(id: string, label: string, ok?: boolean, durationMs?: number) { return this.mutate(id, (t) => { t.events.push(this.event("handoff", label, { ok, durationMs })); }); }
  runtime(id: string, event: RuntimeEvent) {
    if (event.type === "item.started" && event.itemType === "tool") return this.tool(id, event.title ?? "工具调用");
    if (event.type === "item.completed" && event.itemType === "tool") return this.mutate(id, (t) => {
      const last = [...t.events].reverse().find((item) => item.kind === "tool" && item.ok === undefined);
      if (last) { last.ok = event.ok; last.durationMs = Math.max(0, event.createdAt ? Date.parse(event.createdAt) - last.at : 0); }
    });
    if (event.type === "thread.token-usage.updated") return this.mutate(id, (t) => { t.usage = { input: event.input, output: event.output }; });
    if (event.type === "turn.completed" && typeof event.cost === "number" && Number.isFinite(event.cost)) {
      const cost = event.cost;
      return this.mutate(id, (t) => { t.cost = cost; });
    }
    return null;
  }
  finish(id: string, status: Exclude<TraceStatus, "queued" | "running">, errorCode?: ProviderErrorCode) {
    return this.mutate(id, (t) => {
      if (terminal(t.status)) return;
      t.status = status; t.errorCode = errorCode; t.finishedAt = Date.now(); t.durationMs = t.startedAt ? t.finishedAt - t.startedAt : undefined;
      t.events.push(this.event(status === "completed" ? "completed" : status, status === "completed" ? "执行完成" : "执行结束", { ok: status === "completed", errorCode }));
    });
  }
  export(id: string) {
    const trace = this.get(id); if (!trace) return null;
    // Copy only schema-owned fields. This guarantees accidental future fields
    // (such as a provider payload) never leak through the export endpoint.
    return JSON.parse(JSON.stringify({ version: 1, trace: {
      id: trace.id, threadId: trace.threadId, botId: trace.botId, status: trace.status, createdAt: trace.createdAt,
      startedAt: trace.startedAt, finishedAt: trace.finishedAt, queueWaitMs: trace.queueWaitMs, durationMs: trace.durationMs,
      usage: trace.usage, cost: trace.cost, attempts: trace.attempts, failovers: trace.failovers,
      hasExternalSideEffect: trace.hasExternalSideEffect, hasComputerAction: trace.hasComputerAction, errorCode: trace.errorCode,
      events: trace.events,
    }}));
  }
  canReplay(id: string): { ok: boolean; reason?: string; trace?: TaskTrace } {
    const trace = this.get(id);
    if (!trace) return { ok: false, reason: "未找到运行追踪" };
    if (trace.status === "cancelled") return { ok: false, reason: "用户取消的任务不能自动重放" };
    if (trace.hasExternalSideEffect || trace.hasComputerAction) return { ok: false, reason: "包含工具或电脑操作的任务不能自动重放" };
    if (!trace.userMessageId) return { ok: false, reason: "原始消息已不可用" };
    return { ok: true, trace };
  }
  errorCode(error: unknown) { return classifyProviderError(error).code; }
}
