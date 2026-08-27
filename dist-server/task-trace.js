/**
 * Durable, deliberately small execution traces.  This is not a transcript:
 * it records only operational metadata that is safe to export for diagnosis.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { newId } from "./contracts.js";
import { classifyProviderError, redactProviderText } from "./provider-errors.js";
const MAX_TRACES = 300;
const MAX_EVENTS = 120;
const safeLabel = (value, fallback) => redactProviderText(value || fallback).slice(0, 160) || fallback;
const terminal = (status) => status === "completed" || status === "failed" || status === "cancelled";
export class TaskTraceStore {
    traces = new Map();
    dir;
    constructor(dir) { this.dir = dir; this.load(); }
    file(id) { return join(this.dir, `${id}.json`); }
    load() {
        mkdirSync(this.dir, { recursive: true });
        for (const file of readdirSync(this.dir).filter((name) => name.endsWith(".json")).slice(-MAX_TRACES)) {
            try {
                const trace = JSON.parse(readFileSync(join(this.dir, file), "utf8"));
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
            }
            catch { /* corrupt diagnostics never stop the app */ }
        }
        this.prune();
    }
    event(kind, label, extra = {}) {
        return { id: newId(), at: Date.now(), kind, label: safeLabel(label, kind), ...extra };
    }
    persist(trace) { writeFileAtomic(this.file(trace.id), JSON.stringify(trace)); }
    mutate(id, change) {
        const trace = this.traces.get(id);
        if (!trace)
            return null;
        change(trace);
        if (trace.events.length > MAX_EVENTS)
            trace.events.splice(0, trace.events.length - MAX_EVENTS);
        this.persist(trace);
        return trace;
    }
    prune() {
        const old = [...this.traces.values()].sort((a, b) => b.createdAt - a.createdAt).slice(MAX_TRACES);
        for (const trace of old) {
            this.traces.delete(trace.id);
            try {
                if (existsSync(this.file(trace.id)))
                    unlinkSync(this.file(trace.id));
            }
            catch { /* best effort */ }
        }
    }
    create(input) {
        const now = Date.now();
        const trace = {
            id: newId(), threadId: input.threadId, botId: input.botId, userMessageId: input.userMessageId,
            status: "queued", createdAt: now, attempts: [], failovers: 0, hasExternalSideEffect: false, hasComputerAction: false,
            events: [this.event("queued", "已进入机器人队列")],
        };
        this.traces.set(trace.id, trace);
        this.persist(trace);
        this.prune();
        return trace;
    }
    get(id) { return this.traces.get(id) ?? null; }
    findByRootTurn(rootTurnId) { return [...this.traces.values()].find((trace) => trace.rootTurnId === rootTurnId) ?? null; }
    list(threadId, limit = 30) {
        return [...this.traces.values()].filter((trace) => !threadId || trace.threadId === threadId)
            .sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(limit, 100)));
    }
    start(id, rootTurnId) { return this.mutate(id, (t) => { if (!t.startedAt) {
        t.startedAt = Date.now();
        t.queueWaitMs = t.startedAt - t.createdAt;
    } t.rootTurnId ??= rootTurnId; t.status = "running"; t.events.push(this.event("running", "开始执行", { durationMs: t.queueWaitMs })); }); }
    attempt(id, model) { return this.mutate(id, (t) => { t.attempts.push(model); t.events.push(this.event("attempt", "尝试模型", { model })); }); }
    failover(id, from, to, errorCode) { return this.mutate(id, (t) => { t.failovers++; t.events.push(this.event("failover", "自动切换模型", { from, to, errorCode })); }); }
    tool(id, name, ok, durationMs) { return this.mutate(id, (t) => { t.hasExternalSideEffect = true; t.events.push(this.event("tool", safeLabel(name, "工具调用"), { ok, durationMs })); }); }
    computer(id, label, durationMs) { return this.mutate(id, (t) => { t.hasComputerAction = true; t.events.push(this.event("computer", label, { durationMs })); }); }
    handoff(id, label, ok, durationMs) { return this.mutate(id, (t) => { t.events.push(this.event("handoff", label, { ok, durationMs })); }); }
    runtime(id, event) {
        if (event.type === "item.started" && event.itemType === "tool")
            return this.tool(id, event.title ?? "工具调用");
        if (event.type === "item.completed" && event.itemType === "tool")
            return this.mutate(id, (t) => {
                const last = [...t.events].reverse().find((item) => item.kind === "tool" && item.ok === undefined);
                if (last) {
                    last.ok = event.ok;
                    last.durationMs = Math.max(0, event.createdAt ? Date.parse(event.createdAt) - last.at : 0);
                }
            });
        if (event.type === "thread.token-usage.updated")
            return this.mutate(id, (t) => { t.usage = { input: event.input, output: event.output }; });
        if (event.type === "turn.completed" && typeof event.cost === "number" && Number.isFinite(event.cost)) {
            const cost = event.cost;
            return this.mutate(id, (t) => { t.cost = cost; });
        }
        return null;
    }
    finish(id, status, errorCode) {
        return this.mutate(id, (t) => {
            if (terminal(t.status))
                return;
            t.status = status;
            t.errorCode = errorCode;
            t.finishedAt = Date.now();
            t.durationMs = t.startedAt ? t.finishedAt - t.startedAt : undefined;
            t.events.push(this.event(status === "completed" ? "completed" : status, status === "completed" ? "执行完成" : "执行结束", { ok: status === "completed", errorCode }));
        });
    }
    export(id) {
        const trace = this.get(id);
        if (!trace)
            return null;
        // Copy only schema-owned fields. This guarantees accidental future fields
        // (such as a provider payload) never leak through the export endpoint.
        return JSON.parse(JSON.stringify({ version: 1, trace: {
                id: trace.id, threadId: trace.threadId, botId: trace.botId, status: trace.status, createdAt: trace.createdAt,
                startedAt: trace.startedAt, finishedAt: trace.finishedAt, queueWaitMs: trace.queueWaitMs, durationMs: trace.durationMs,
                usage: trace.usage, cost: trace.cost, attempts: trace.attempts, failovers: trace.failovers,
                hasExternalSideEffect: trace.hasExternalSideEffect, hasComputerAction: trace.hasComputerAction, errorCode: trace.errorCode,
                events: trace.events,
            } }));
    }
    canReplay(id) {
        const trace = this.get(id);
        if (!trace)
            return { ok: false, reason: "未找到运行追踪" };
        if (trace.status === "cancelled")
            return { ok: false, reason: "用户取消的任务不能自动重放" };
        if (trace.hasExternalSideEffect || trace.hasComputerAction)
            return { ok: false, reason: "包含工具或电脑操作的任务不能自动重放" };
        if (!trace.userMessageId)
            return { ok: false, reason: "原始消息已不可用" };
        return { ok: true, trace };
    }
    errorCode(error) { return classifyProviderError(error).code; }
}
