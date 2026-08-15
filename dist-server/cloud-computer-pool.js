/**
 * A Box exposes one interactive X11 desktop. Sharing it is cheap, but two
 * agents clicking/type-writing concurrently corrupt each other's work. Keep
 * one FIFO lease per physical Box for the whole provider turn.
 */
export class CloudComputerLeasePool {
    tails = new Map();
    queued = new Map();
    async acquire(boxId, onWait, signal) {
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
            void tail.finally(() => {
                if (this.tails.get(boxId) === tail)
                    this.tails.delete(boxId);
            });
        };
    }
    isBusy(boxId) {
        return (this.queued.get(boxId) ?? 0) > 0;
    }
}
export const cloudComputerLeases = new CloudComputerLeasePool();
