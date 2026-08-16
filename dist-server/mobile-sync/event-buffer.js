export class EventBuffer {
    items = [];
    ids = new Set();
    capacity;
    constructor(capacity = 1_000) { this.capacity = capacity; }
    push(event) {
        if (this.ids.has(event.eventId))
            return false;
        this.items.push(event);
        this.ids.add(event.eventId);
        while (this.items.length > this.capacity) {
            const removed = this.items.shift();
            if (removed)
                this.ids.delete(removed.eventId);
        }
        return true;
    }
    values() { return this.items; }
    clear() { this.items.length = 0; this.ids.clear(); }
}
