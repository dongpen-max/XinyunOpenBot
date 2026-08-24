/**
 * Per-bot turn scheduling.
 *
 * A Bot remains single-threaded (one provider turn at a time), while the
 * workspace can run different Bots concurrently.  Human messages are kept
 * ahead of background handoffs, but FIFO order is preserved within a
 * priority.  The scheduler is intentionally transport-agnostic so it can be
 * reused by the HTTP harness and tested without booting providers.
 */

export type TurnPriority = "urgent" | "normal" | "background";

export interface ScheduledTurn<T> {
  id: string;
  botId: string;
  value: T;
  priority: TurnPriority;
  enqueuedAt: number;
}

const PRIORITY: Record<TurnPriority, number> = {
  urgent: 0,
  normal: 1,
  background: 2,
};

export class TurnScheduler<T> {
  private readonly queues = new Map<string, ScheduledTurn<T>[]>();
  private readonly active = new Set<string>();
  private sequence = 0;

  enqueue(botId: string, value: T, priority: TurnPriority, id = `turn-${++this.sequence}`): ScheduledTurn<T> {
    const item: ScheduledTurn<T> = { id, botId, value, priority, enqueuedAt: Date.now() };
    const queue = this.queues.get(botId) ?? [];
    queue.push(item);
    queue.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.enqueuedAt - b.enqueuedAt);
    this.queues.set(botId, queue);
    return item;
  }

  begin(botId: string): ScheduledTurn<T> | null {
    if (this.active.has(botId)) return null;
    const queue = this.queues.get(botId);
    const item = queue?.shift() ?? null;
    if (!item) {
      if (queue) this.queues.delete(botId);
      return null;
    }
    this.active.add(botId);
    if (!queue?.length) this.queues.delete(botId);
    return item;
  }

  complete(botId: string): void {
    this.active.delete(botId);
  }

  isActive(botId: string): boolean {
    return this.active.has(botId);
  }

  hasPending(botId: string): boolean {
    return (this.queues.get(botId)?.length ?? 0) > 0;
  }

  pending(botId: string): number {
    return this.queues.get(botId)?.length ?? 0;
  }

  depth(botId: string): number {
    return (this.active.has(botId) ? 1 : 0) + this.pending(botId);
  }

  cancelQueued(botId: string, predicate?: (item: ScheduledTurn<T>) => boolean): ScheduledTurn<T>[] {
    const queue = this.queues.get(botId);
    if (!queue?.length) return [];
    const cancelled = predicate ? queue.filter(predicate) : [...queue];
    const kept = predicate ? queue.filter((item) => !predicate(item)) : [];
    if (kept.length) this.queues.set(botId, kept);
    else this.queues.delete(botId);
    return cancelled;
  }

  clear(): void {
    this.queues.clear();
    this.active.clear();
  }
}
