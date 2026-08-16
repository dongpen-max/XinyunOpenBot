import { describe, expect, it, vi } from "vitest";

import { createRefreshGate } from "../src/lib/engine-refresh.ts";

describe("createRefreshGate", () => {
  it("coalesces focus events and throttles immediate repeats", async () => {
    let now = 10_000;
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const run = createRefreshGate(refresh, 3_000, () => now);
    const first = run();
    const same = run();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
    expect(await same).toBe(true);
    expect(await run()).toBe(false);
    now += 3_001;
    const next = run();
    release();
    expect(await next).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("allows a later probe after one refresh fails", async () => {
    let now = 0;
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const run = createRefreshGate(refresh, 10, () => now);
    expect(await run()).toBe(false);
    now = 11;
    expect(await run()).toBe(true);
  });
});
