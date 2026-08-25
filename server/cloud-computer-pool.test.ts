import { describe, expect, it, vi } from "vitest";

import { CloudComputerLeasePool } from "./cloud-computer-pool.ts";

describe("CloudComputerLeasePool", () => {
  it("serializes turns that share one cloud server", async () => {
    const pool = new CloudComputerLeasePool();
    const first = await pool.acquire("box-primary", undefined, undefined, { botId: "bot-a", task: "first task" });
    expect(pool.status("box-primary")).toMatchObject({
      busy: true,
      waiting: 0,
      owner: { botId: "bot-a", task: "first task" },
    });
    const waited = vi.fn();
    let secondAcquired = false;
    const secondPromise = pool.acquire("box-primary", waited).then((release) => {
      secondAcquired = true;
      return release;
    });

    await Promise.resolve();
    expect(waited).toHaveBeenCalledOnce();
    expect(secondAcquired).toBe(false);
    expect(pool.status("box-primary").waiting).toBe(1);

    first();
    const second = await secondPromise;
    expect(secondAcquired).toBe(true);
    second();
    expect(pool.status("box-primary")).toMatchObject({ busy: false, waiting: 0, owner: null });
  });

  it("does not block independent servers", async () => {
    const pool = new CloudComputerLeasePool();
    const first = await pool.acquire("box-a");
    const second = await pool.acquire("box-b");
    first();
    second();
  });

  it("removes a cancelled waiter without blocking the queue behind it", async () => {
    const pool = new CloudComputerLeasePool();
    const first = await pool.acquire("box-primary");
    const controller = new AbortController();
    const cancelled = pool.acquire("box-primary", undefined, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/i);

    let thirdAcquired = false;
    const thirdPromise = pool.acquire("box-primary").then((release) => {
      thirdAcquired = true;
      return release;
    });
    first();
    const third = await thirdPromise;
    expect(thirdAcquired).toBe(true);
    third();
  });
});
