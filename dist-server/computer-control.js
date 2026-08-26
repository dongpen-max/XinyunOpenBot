const EMPTY = { held: false, helpReason: null, heldSinceMs: null, requestId: null, expiresAtMs: null };
const MAX_REASON = 280;
const DEFAULT_TAKEOVER_TIMEOUT_MS = 15 * 60_000;
export class ComputerControl {
    entries = new Map();
    timers = new Map();
    sequence = 0;
    onChange;
    constructor(onChange) {
        this.onChange = onChange;
    }
    snapshot(botId) {
        const entry = this.entries.get(botId);
        if (!entry)
            return EMPTY;
        return {
            held: entry.heldSinceMs !== null,
            helpReason: entry.helpReason,
            heldSinceMs: entry.heldSinceMs,
            requestId: entry.requestId,
            expiresAtMs: entry.expiresAtMs,
        };
    }
    take(botId, timeoutMs = DEFAULT_TAKEOVER_TIMEOUT_MS) {
        const current = this.entries.get(botId);
        if (current?.heldSinceMs !== null && current?.heldSinceMs !== undefined)
            return this.snapshot(botId);
        this.entries.set(botId, {
            heldSinceMs: Date.now(),
            helpReason: current?.helpReason ?? null,
            requestId: current?.requestId ?? null,
            expiresAtMs: Date.now() + timeoutMs,
        });
        const timer = setTimeout(() => {
            const entry = this.entries.get(botId);
            if (entry?.heldSinceMs !== null && entry?.expiresAtMs && entry.expiresAtMs <= Date.now()) {
                this.release(botId);
            }
        }, timeoutMs);
        timer.unref?.();
        this.timers.set(botId, timer);
        const snapshot = this.snapshot(botId);
        this.onChange?.(botId, snapshot);
        return snapshot;
    }
    release(botId) {
        const timer = this.timers.get(botId);
        if (timer)
            clearTimeout(timer);
        this.timers.delete(botId);
        this.entries.delete(botId);
        const snapshot = this.snapshot(botId);
        this.onChange?.(botId, snapshot);
        return snapshot;
    }
    requestHelp(botId, reason) {
        const current = this.entries.get(botId) ?? { heldSinceMs: null, helpReason: null, requestId: null, expiresAtMs: null };
        if (!current.helpReason) {
            const text = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
            current.helpReason = text || "机器人请求你接管云电脑";
            current.requestId = `${botId}-${++this.sequence}`;
        }
        this.entries.set(botId, current);
        const snapshot = this.snapshot(botId);
        this.onChange?.(botId, snapshot);
        return snapshot;
    }
    dismissHelp(botId) {
        const current = this.entries.get(botId);
        if (!current)
            return EMPTY;
        current.helpReason = null;
        current.requestId = null;
        if (current.heldSinceMs === null)
            this.entries.delete(botId);
        const snapshot = this.snapshot(botId);
        this.onChange?.(botId, snapshot);
        return snapshot;
    }
    expireHelp(botId, requestId) {
        const current = this.entries.get(botId);
        if (!current || current.requestId !== requestId)
            return this.snapshot(botId);
        return this.dismissHelp(botId);
    }
    forget(botId) {
        const timer = this.timers.get(botId);
        if (timer)
            clearTimeout(timer);
        this.timers.delete(botId);
        this.entries.delete(botId);
    }
}
export const COMPUTER_CONTROL_REFUSAL = "用户正在接管这台云电脑，本次操作未执行。不要重试；请等待用户交还控制权，然后重新截图再继续。";
/** Shared server/proxy gate: model switches never bypass a human lease. */
export function computerControlRefusal(snapshot) {
    return snapshot.held ? COMPUTER_CONTROL_REFUSAL : null;
}
