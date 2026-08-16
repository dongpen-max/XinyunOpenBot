export function createRefreshGate(
  refresh: () => Promise<unknown>,
  minIntervalMs = 3_000,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<boolean> | null = null;
  return () => {
    if (pending) return pending;
    const at = now();
    if (at - lastStartedAt < minIntervalMs) return Promise.resolve(false);
    lastStartedAt = at;
    pending = refresh()
      .then(() => true, () => false)
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
