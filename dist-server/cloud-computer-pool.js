/**
 * A Box exposes one interactive X11 desktop. Sharing it is cheap, but two
 * agents clicking/type-writing concurrently corrupt each other's work. Keep
 * one FIFO lease per physical Box for the whole provider turn.
 */
export class CloudComputerLeasePool {
    tails = new Map();
    queued = new Map();
    owners = new Map();
    async acquire(boxId, onWait, signal, meta) {
        if (signal?.aborted)
            throw new Error("cloud computer queue cancelled");
        const previous = this.tails.get(boxId) ?? Promise.resolve();
        const ahead = this.queued.get(boxId) ?? 0;
        if (ahead > 0)
            onWait?.();
        this.queued.set(boxId, ahead + 1);
        let unlock;
        const current = new Promise((resolve) => {
            unlock = resolve;
        });
        const tail = previous.then(() => current);
        this.tails.set(boxId, tail);
        let abortListener;
        const aborted = new Promise((_, reject) => {
            if (!signal)
                return;
            abortListener = () => reject(new Error("cloud computer queue cancelled"));
            signal.addEventListener("abort", abortListener, { once: true });
        });
        try {
            await (signal ? Promise.race([previous, aborted]) : previous);
        }
        catch (error) {
            const remaining = Math.max(0, (this.queued.get(boxId) ?? 1) - 1);
            if (remaining)
                this.queued.set(boxId, remaining);
            else
                this.queued.delete(boxId);
            unlock();
            throw error;
        }
        finally {
            if (signal && abortListener)
                signal.removeEventListener("abort", abortListener);
        }
        let released = false;
        const ownerSinceMs = Date.now();
        this.owners.set(boxId, { ...meta, sinceMs: ownerSinceMs });
        return () => {
            if (released)
                return;
            released = true;
            const remaining = Math.max(0, (this.queued.get(boxId) ?? 1) - 1);
            if (remaining)
                this.queued.set(boxId, remaining);
            else
                this.queued.delete(boxId);
            unlock();
            if (this.owners.get(boxId)?.sinceMs === ownerSinceMs)
                this.owners.delete(boxId);
            void tail.finally(() => {
                if (this.tails.get(boxId) === tail)
                    this.tails.delete(boxId);
            });
        };
    }
    isBusy(boxId) {
        return (this.queued.get(boxId) ?? 0) > 0;
    }
    status(boxId) {
        const queued = this.queued.get(boxId) ?? 0;
        const hasOwner = this.owners.has(boxId);
        return {
            busy: queued > 0 || hasOwner,
            // `queued` includes the active lease. During the tiny hand-off window
            // before the owner record is installed, report the sole entry as active
            // rather than exposing a phantom waiter.
            waiting: Math.max(0, queued - (hasOwner || queued === 1 ? 1 : 0)),
            owner: this.owners.get(boxId) ?? null,
        };
    }
}
export const cloudComputerLeases = new CloudComputerLeasePool();
