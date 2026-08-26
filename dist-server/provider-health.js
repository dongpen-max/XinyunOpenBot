import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { writeFileAtomic } from "./atomic.js";
const EMPTY = () => ({
    successes: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCode: null,
    averageLatencyMs: null,
    rateLimited: false,
    timedOut: false,
    temporarilyUnavailable: false,
    circuitOpenUntilMs: 0,
    activeRequests: 0,
});
const instanceKey = (instanceId) => `instance:${instanceId}`;
const modelKey = (instanceId, model) => `model:${instanceId}:${model}`;
export class ProviderHealthTracker {
    metrics = new Map();
    openedThisBoot = new Set();
    file;
    now;
    constructor(file, now = Date.now) {
        this.file = file;
        this.now = now;
        if (!file)
            return;
        try {
            const raw = JSON.parse(readFileSync(file, "utf8"));
            for (const [key, value] of Object.entries(raw)) {
                const next = EMPTY();
                next.successes = Math.max(0, Number(value.successes) || 0);
                next.consecutiveFailures = Math.max(0, Number(value.consecutiveFailures) || 0);
                next.lastSuccessAt = typeof value.lastSuccessAt === "string" ? value.lastSuccessAt : null;
                next.lastFailureAt = typeof value.lastFailureAt === "string" ? value.lastFailureAt : null;
                next.lastErrorCode = value.lastErrorCode ?? null;
                next.averageLatencyMs = Number.isFinite(value.averageLatencyMs) ? Math.max(0, Number(value.averageLatencyMs)) : null;
                // Circuits and temporary flags are intentionally boot-local. A crash
                // or upgrade can never strand an instance in a permanent open state.
                this.metrics.set(key, next);
            }
        }
        catch {
            /* first run or a damaged optional metrics file */
        }
    }
    get(key) {
        const value = this.metrics.get(key) ?? EMPTY();
        this.metrics.set(key, value);
        return value;
    }
    keys(instanceId, model) {
        return [instanceKey(instanceId), modelKey(instanceId, model)];
    }
    startAttempt(instanceId, model) {
        for (const key of this.keys(instanceId, model))
            this.get(key).activeRequests += 1;
        return { instanceId, model, startedAt: this.now(), finished: false };
    }
    recordSuccess(attempt) {
        if (attempt.finished)
            return;
        attempt.finished = true;
        const completedAt = this.now();
        const latency = Math.max(0, completedAt - attempt.startedAt);
        for (const key of this.keys(attempt.instanceId, attempt.model)) {
            const value = this.get(key);
            value.activeRequests = Math.max(0, value.activeRequests - 1);
            value.successes += 1;
            value.consecutiveFailures = 0;
            value.lastSuccessAt = new Date(completedAt).toISOString();
            value.lastErrorCode = null;
            value.averageLatencyMs = value.averageLatencyMs === null ? latency : Math.round(value.averageLatencyMs * 0.7 + latency * 0.3);
            value.rateLimited = false;
            value.timedOut = false;
            value.temporarilyUnavailable = false;
            value.circuitOpenUntilMs = 0;
            this.openedThisBoot.delete(key);
        }
        this.save();
    }
    recordFailure(attempt, error) {
        if (attempt.finished)
            return;
        attempt.finished = true;
        const failedAt = this.now();
        for (const key of this.keys(attempt.instanceId, attempt.model)) {
            const value = this.get(key);
            value.activeRequests = Math.max(0, value.activeRequests - 1);
            value.consecutiveFailures += 1;
            value.lastFailureAt = new Date(failedAt).toISOString();
            value.lastErrorCode = error.code;
            value.rateLimited = error.code === "rate_limited";
            value.timedOut = error.code === "timeout";
            value.temporarilyUnavailable = error.code === "temporarily_unavailable" || error.code === "connection_lost";
            const shouldOpen = error.code === "rate_limited" || value.consecutiveFailures >= 3 || this.openedThisBoot.has(key);
            if (shouldOpen && error.recoverable) {
                value.circuitOpenUntilMs = failedAt + (error.retryAfterMs ?? 30_000);
                this.openedThisBoot.add(key);
            }
        }
        this.save();
    }
    recordCancelled(attempt) {
        if (attempt.finished)
            return;
        attempt.finished = true;
        for (const key of this.keys(attempt.instanceId, attempt.model)) {
            const value = this.get(key);
            value.activeRequests = Math.max(0, value.activeRequests - 1);
        }
    }
    snapshot(instanceId, model) {
        const key = model === undefined ? instanceKey(instanceId) : modelKey(instanceId, model);
        const value = this.get(key);
        const now = this.now();
        const open = value.circuitOpenUntilMs > now;
        const halfOpen = !open && this.openedThisBoot.has(key);
        return {
            successes: value.successes,
            consecutiveFailures: value.consecutiveFailures,
            lastSuccessAt: value.lastSuccessAt,
            lastFailureAt: value.lastFailureAt,
            lastErrorCode: value.lastErrorCode,
            averageLatencyMs: value.averageLatencyMs,
            rateLimited: value.rateLimited,
            timedOut: value.timedOut,
            temporarilyUnavailable: value.temporarilyUnavailable,
            circuitState: open ? "open" : halfOpen ? "half_open" : "closed",
            circuitOpenUntil: open ? new Date(value.circuitOpenUntilMs).toISOString() : null,
            activeRequests: value.activeRequests,
        };
    }
    save() {
        if (!this.file)
            return;
        const out = {};
        for (const [key, value] of this.metrics) {
            out[key] = {
                successes: value.successes,
                consecutiveFailures: value.consecutiveFailures,
                lastSuccessAt: value.lastSuccessAt,
                lastFailureAt: value.lastFailureAt,
                lastErrorCode: value.lastErrorCode,
                averageLatencyMs: value.averageLatencyMs,
            };
        }
        try {
            mkdirSync(dirname(this.file), { recursive: true });
            writeFileAtomic(this.file, JSON.stringify(out, null, 2));
        }
        catch {
            /* health telemetry must never block a turn */
        }
    }
}
