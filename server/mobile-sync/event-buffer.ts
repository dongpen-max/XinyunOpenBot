export class EventBuffer<T extends { eventId: string }> {
  private readonly items: T[] = [];
  private readonly ids = new Set<string>();
  private readonly capacity: number;

  constructor(capacity = 1_000) { this.capacity = capacity; }

  push(event: T): boolean {
    if (this.ids.has(event.eventId)) return false;
    this.items.push(event);
    this.ids.add(event.eventId);
    while (this.items.length > this.capacity) {
      const removed = this.items.shift();
      if (removed) this.ids.delete(removed.eventId);
    }
    return true;
  }

  values(): readonly T[] { return this.items; }
  clear(): void { this.items.length = 0; this.ids.clear(); }
}
