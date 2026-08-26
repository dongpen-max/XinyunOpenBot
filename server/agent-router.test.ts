import { describe, expect, it } from "vitest";

import {
  candidateKey,
  detectTurnRequirements,
  nextFailoverCandidate,
  routeCandidates,
  type AgentCandidate,
} from "./agent-router.ts";

function candidate(
  instanceId: string,
  model: string,
  patch: Partial<AgentCandidate> = {},
): AgentCandidate {
  return {
    instanceId,
    driverKind: instanceId,
    displayName: instanceId,
    model,
    modelLabel: model,
    capabilities: {
      textChat: true,
      reasoningLevels: ["low", "medium", "high"],
      coding: true,
      agentTools: true,
      mcpTools: true,
      imageInput: true,
      imageGeneration: null,
      localComputer: true,
      cloudComputer: true,
      browser: true,
      maxContextTokens: null,
      sessionResume: true,
      streaming: true,
      available: true,
    },
    health: {
      successes: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      averageLatencyMs: null,
      rateLimited: false,
      timedOut: false,
      temporarilyUnavailable: false,
      circuitState: "closed",
      circuitOpenUntil: null,
      activeRequests: 0,
    },
    qualityScore: null,
    costScore: null,
    ...patch,
  };
}

describe("agent capability routing", () => {
  it("manual mode never changes the selected model", () => {
    const a = candidate("a", "a-1");
    const b = candidate("b", "b-1", { health: { ...candidate("x", "x").health, averageLatencyMs: 1 } });
    const result = routeCandidates({
      mode: "manual",
      preferred: { instanceId: "a", model: "a-1" },
      requirements: {},
      candidates: [b, a],
    });
    expect(result.candidates.map(candidateKey)).toEqual([candidateKey(a)]);
  });

  it("filters hard capability mismatches before sorting", () => {
    const noVision = candidate("a", "text", { capabilities: { ...candidate("x", "x").capabilities, imageInput: false } });
    const vision = candidate("b", "vision");
    const result = routeCandidates({
      mode: "balanced",
      preferred: { instanceId: "a", model: "text" },
      requirements: { imageInput: true, agentTools: true, mcpTools: true },
      candidates: [noVision, vision],
    });
    expect(result.candidates.map(candidateKey)).toEqual([candidateKey(vision)]);
    expect(result.excluded[0].reason).toBe("不支持图片输入");
  });

  it("prefers a healthy candidate over a circuit-open preferred model", () => {
    const open = candidate("a", "preferred", {
      health: { ...candidate("x", "x").health, circuitState: "open", circuitOpenUntil: new Date(Date.now() + 30_000).toISOString() },
    });
    const healthy = candidate("b", "healthy");
    const result = routeCandidates({
      mode: "balanced",
      preferred: { instanceId: "a", model: "preferred" },
      requirements: {},
      candidates: [open, healthy],
    });
    expect(result.candidates.map(candidateKey)).toEqual([candidateKey(healthy)]);
  });

  it("keeps automatic chat-only work out of the computer lane", () => {
    expect(detectTurnRequirements({ text: "写一个排序函数", computer: undefined, automatic: true })).toEqual({ cloudComputer: false });
    expect(detectTurnRequirements({ text: "打开浏览器", computer: "cloud", automatic: true })).toMatchObject({ cloudComputer: true, browser: true });
  });
});

describe("automatic failover", () => {
  const a = candidate("a", "a-1");
  const b = candidate("b", "b-1");
  const c = candidate("c", "c-1");

  it.each([
    ["rate_limited", "429"],
    ["timeout", "timeout"],
  ] as const)("moves to the next candidate after %s", (code, _example) => {
    const next = nextFailoverCandidate(
      { candidates: [a, b], attempted: [candidateKey(a)], maxFailovers: 2 },
      { code, recoverable: true },
    );
    expect(next).toMatchObject({ reason: "retry", candidate: b });
  });

  it("does not switch after user cancellation or a replay-unsafe action", () => {
    expect(nextFailoverCandidate(
      { candidates: [a, b], attempted: [candidateKey(a)], maxFailovers: 2, cancelled: true },
      { code: "timeout", recoverable: true },
    ).reason).toBe("cancelled");
    expect(nextFailoverCandidate(
      { candidates: [a, b], attempted: [candidateKey(a)], maxFailovers: 2, computerAction: true },
      { code: "timeout", recoverable: true },
    ).reason).toBe("replay_blocked");
    expect(nextFailoverCandidate(
      { candidates: [a, b], attempted: [candidateKey(a)], maxFailovers: 2, externalSideEffect: true },
      { code: "rate_limited", recoverable: true },
    ).reason).toBe("replay_blocked");
  });

  it("enforces the maximum and never cycles through an attempted candidate", () => {
    expect(nextFailoverCandidate(
      { candidates: [a, b, c], attempted: [candidateKey(a), candidateKey(b)], maxFailovers: 1 },
      { code: "timeout", recoverable: true },
    ).reason).toBe("limit");
    const noCycle = nextFailoverCandidate(
      { candidates: [a, b, a], attempted: [candidateKey(a)], maxFailovers: 3 },
      { code: "timeout", recoverable: true },
    );
    expect(noCycle.candidate).toBe(b);
  });

  it("returns an explicit exhausted result when every candidate failed", () => {
    const result = nextFailoverCandidate(
      { candidates: [a, b], attempted: [candidateKey(a), candidateKey(b)], maxFailovers: 4 },
      { code: "temporarily_unavailable", recoverable: true },
    );
    expect(result).toEqual({ candidate: null, reason: "exhausted" });
  });
});
