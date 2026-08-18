/** Compact, human-readable token totals for task metadata. */
export function formatTokens(total: number): string | null {
  if (!Number.isFinite(total) || total < 1) return null;
  const n = Math.trunc(total);
  if (n < 1000) return n === 1 ? "1 token" : `${n} tokens`;
  const kTenths = Math.round(n / 100);
  if (kTenths < 10_000) return `${tenths(kTenths)}k`;
  return `${tenths(Math.round(n / 100_000))}M`;
}

function tenths(value: number): string {
  const fraction = value % 10;
  return fraction === 0 ? `${value / 10}` : `${(value - fraction) / 10}.${fraction}`;
}
