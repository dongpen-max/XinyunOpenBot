/**
 * Per-bot turn scheduling.
 *
 * A Bot remains single-threaded (one provider turn at a time), while the
 * workspace can run different Bots concurrently.  Human messages are kept
 * ahead of background handoffs, but FIFO order is preserved within a
 * priority.  The scheduler is intentionally transport-agnostic so it can be
 * reused by the HTTP harness and tested without booting providers.
 */
const PRIORITY = {
    urgent: 0,
    normal: 1,
    background: 2,
};
export class TurnScheduler {
    queues = new Map();
    active = new Set();
    sequence = 0;
    enqueue(botId, value, priority, id = `turn-${++this.sequence}`) {
        const item = { id, botId, value, priority, enqueuedAt: Date.now() };
        const queue = this.queues.get(botId) ?? [];
        queue.push(item);
        queue.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.enqueuedAt - b.enqueuedAt);
        this.queues.set(botId, queue);
        return item;
    }
    begin(botId) {
        if (this.active.has(botId))
            return null;
        const queue = this.queues.get(botId);
        const item = queue?.shift() ?? null;
        if (!item) {
            if (queue)
                this.queues.delete(botId);
            return null;
        }
        this.active.add(botId);
        if (!queue?.length)
            this.queues.delete(botId);
        return item;
    }
    complete(botId) {
        this.active.delete(botId);
    }
    isActive(botId) {
        return this.active.has(botId);
    }
    hasPending(botId) {
        return (this.queues.get(botId)?.length ?? 0) > 0;
    }
    pending(botId) {
        return this.queues.get(botId)?.length ?? 0;
    }
    depth(botId) {
        return (this.active.has(botId) ? 1 : 0) + this.pending(botId);
    }
    cancelQueued(botId, predicate) {
        const queue = this.queues.get(botId);
        if (!queue?.length)
            return [];
        const cancelled = predicate ? queue.filter(predicate) : [...queue];
        const kept = predicate ? queue.filter((item) => !predicate(item)) : [];
        if (kept.length)
            this.queues.set(botId, kept);
        else
            this.queues.delete(botId);
        return cancelled;
    }
    clear() {
        this.queues.clear();
        this.active.clear();
    }
}
