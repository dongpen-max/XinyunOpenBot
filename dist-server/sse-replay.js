import { randomBytes } from "node:crypto";
/** Bounded, restart-safe replay buffer for reconnecting SSE clients. */
export class SseReplayBuffer {
    entries = [];
    streamId;
    maxEntries;
    seq = 0;
    constructor(streamId = randomBytes(4).toString("hex"), maxEntries = 500) {
        this.streamId = streamId;
        this.maxEntries = maxEntries;
    }
    cursor() {
        return `${this.streamId}:${this.seq}`;
    }
    append(payload) {
        const seq = ++this.seq;
        const kind = String(payload.kind ?? "");
        const frame = `id: ${this.streamId}:${seq}\ndata: ${JSON.stringify({ ...payload, seq })}\n\n`;
        // Live screen captures are large and stale immediately. Preserve their
        // sequence slots for honest gap detection without retaining the pixels.
        this.entries.push({ seq, kind, frame: kind === "screen" ? null : frame });
        if (this.entries.length > this.maxEntries)
            this.entries.shift();
        return { seq, kind, frame };
    }
    resume(rawCursor, wants = () => true) {
        const since = this.parseCursor(rawCursor);
        const resumed = since !== null &&
            since <= this.seq &&
            (this.entries.length === 0 ? since === this.seq : this.entries[0].seq <= since + 1);
        return {
            cursor: this.cursor(),
            resumed,
            frames: resumed
                ? this.entries
                    .filter((entry) => entry.seq > since && entry.frame && wants(entry.kind))
                    .map((entry) => entry.frame)
                : [],
        };
    }
    parseCursor(raw) {
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (!value)
            return null;
        const [stream, seq] = value.split(":");
        if (stream !== this.streamId)
            return null;
        const parsed = Number(seq);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }
}
