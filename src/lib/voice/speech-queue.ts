/** FIFO queue with an epoch token. Callbacks from interrupted turns can still
 * fire, but their audio is rejected instead of being spoken later. */
export class SpeechTurnQueue<T> {
  private values: Array<{ epoch: number; value: T }> = [];
  private currentEpoch = 0;

  get epoch(): number {
    return this.currentEpoch;
  }

  get length(): number {
    return this.values.length;
  }

  enqueue(values: readonly T[], epoch = this.currentEpoch): number {
    if (epoch !== this.currentEpoch || values.length === 0) return 0;
    this.values.push(...values.map((value) => ({ epoch, value })));
    return values.length;
  }

  peek(): T | undefined {
    this.dropStale();
    return this.values[0]?.value;
  }

  shift(): T | undefined {
    this.dropStale();
    return this.values.shift()?.value;
  }

  invalidate(): number {
    this.currentEpoch += 1;
    this.values = [];
    return this.currentEpoch;
  }

  private dropStale() {
    while (this.values[0] && this.values[0].epoch !== this.currentEpoch) this.values.shift();
  }
}
