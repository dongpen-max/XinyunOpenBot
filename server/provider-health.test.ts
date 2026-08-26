import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderHealthTracker } from "./provider-health.ts";
import { classifyProviderError } from "./provider-errors.ts";

describe("ProviderHealthTracker", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("opens, half-opens, and recovers a rate-limited circuit", () => {
    let now = Date.parse("2026-08-26T00:00:00.000Z");
    const tracker = new ProviderHealthTracker(undefined, () => now);
    const first = tracker.startAttempt("provider-a", "model-a");
    tracker.recordFailure(first, classifyProviderError("HTTP 429 quota exceeded"));
    expect(tracker.snapshot("provider-a", "model-a")).toMatchObject({
      consecutiveFailures: 1,
      rateLimited: true,
      circuitState: "open",
    });

    now += 61_000;
    expect(tracker.snapshot("provider-a", "model-a").circuitState).toBe("half_open");
    const probe = tracker.startAttempt("provider-a", "model-a");
    now += 250;
    tracker.recordSuccess(probe);
    expect(tracker.snapshot("provider-a", "model-a")).toMatchObject({
      successes: 1,
      consecutiveFailures: 0,
      rateLimited: false,
      circuitState: "closed",
      averageLatencyMs: 250,
    });
  });

  it("persists redacted metrics but clears temporary circuits on restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-health-"));
    dirs.push(dir);
    const file = join(dir, "health.json");
    const tracker = new ProviderHealthTracker(file);
    tracker.recordFailure(
      tracker.startAttempt("provider-a", "model-a"),
      classifyProviderError("HTTP 429 Authorization: Bearer should-never-persist"),
    );
    const disk = readFileSync(file, "utf8");
    expect(disk).not.toMatch(/Bearer|Authorization|should-never-persist|api.?key/i);

    const restarted = new ProviderHealthTracker(file);
    expect(restarted.snapshot("provider-a", "model-a")).toMatchObject({
      consecutiveFailures: 1,
      circuitState: "closed",
      rateLimited: false,
      temporarilyUnavailable: false,
    });
  });

  it("does not penalize user cancellation", () => {
    const tracker = new ProviderHealthTracker();
    const attempt = tracker.startAttempt("provider-a", "model-a");
    tracker.recordCancelled(attempt);
    expect(tracker.snapshot("provider-a", "model-a")).toMatchObject({
      consecutiveFailures: 0,
      successes: 0,
      activeRequests: 0,
    });
  });
});
