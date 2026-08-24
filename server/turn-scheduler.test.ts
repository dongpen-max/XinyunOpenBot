import { describe, expect, it } from "vitest";
import { TurnScheduler } from "./turn-scheduler.ts";

describe("TurnScheduler", () => {
  it("keeps one active turn per bot while allowing different bots", () => {
    const s = new TurnScheduler<string>();
    s.enqueue("a", "a1", "normal");
    s.enqueue("a", "a2", "normal");
    s.enqueue("b", "b1", "normal");
    expect(s.begin("a")?.value).toBe("a1");
    expect(s.begin("a")).toBeNull();
    expect(s.begin("b")?.value).toBe("b1");
    expect(s.depth("a")).toBe(2);
  });

  it("orders urgent work before normal/background and preserves FIFO", () => {
    const s = new TurnScheduler<string>();
    s.enqueue("a", "background-1", "background");
    s.enqueue("a", "normal", "normal");
    s.enqueue("a", "urgent", "urgent");
    s.enqueue("a", "background-2", "background");
    expect(s.begin("a")?.value).toBe("urgent");
    s.complete("a");
    expect(s.begin("a")?.value).toBe("normal");
    s.complete("a");
    expect(s.begin("a")?.value).toBe("background-1");
    s.complete("a");
    expect(s.begin("a")?.value).toBe("background-2");
  });

  it("cancels queued items without touching the active turn", () => {
    const s = new TurnScheduler<string>();
    s.enqueue("a", "active", "normal");
    s.enqueue("a", "drop", "background");
    s.begin("a");
    expect(s.cancelQueued("a").map((x) => x.value)).toEqual(["drop"]);
    expect(s.isActive("a")).toBe(true);
    expect(s.pending("a")).toBe(0);
  });
});
