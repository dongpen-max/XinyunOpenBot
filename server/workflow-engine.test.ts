import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WorkflowEngine, validateWorkflowNodes, type WorkflowRecord } from "./workflow-engine.ts";

const dirs: string[] = [];
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), "omb-workflow-")); dirs.push(dir); return join(dir, "workflows.json"); };
const waitFor = async (read: () => boolean, timeout = 2_000) => {
  const end = Date.now() + timeout;
  while (!read() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(read()).toBe(true);
};
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("WorkflowEngine", () => {
  it("rejects missing dependencies and cycles", () => {
    expect(validateWorkflowNodes([{ id: "a", dependsOn: ["missing"] }])).toContain("依赖");
    expect(validateWorkflowNodes([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])).toContain("循环");
    expect(validateWorkflowNodes([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: ["a"] }])).toBeNull();
  });

  it("runs independent nodes in parallel then unlocks their dependent node", async () => {
    const file = fixture(); let concurrent = 0; let peak = 0; const order: string[] = [];
    const engine = new WorkflowEngine(file, async (_workflow, node) => {
      concurrent++; peak = Math.max(peak, concurrent); order.push(`start:${node.id}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      concurrent--; order.push(`end:${node.id}`); return { ok: true, result: node.id === "a" ? "https://example.com/report?token=fixture" : node.id };
    });
    const workflow = engine.create({ name: "并行", ownerBotId: "owner", objective: "目标", nodes: [
      { id: "a", title: "A", prompt: "A", botId: "one" },
      { id: "b", title: "B", prompt: "B", botId: "two" },
      { id: "c", title: "C", prompt: "C", botId: "owner", dependsOn: ["a", "b"] },
    ] });
    engine.run(workflow.id);
    await waitFor(() => engine.get(workflow.id)?.status === "completed");
    expect(peak).toBe(2);
    expect(order.indexOf("start:c")).toBeGreaterThan(order.indexOf("end:a"));
    expect(order.indexOf("start:c")).toBeGreaterThan(order.indexOf("end:b"));
    expect(engine.get(workflow.id)?.space.sources[0]?.url).toBe("https://example.com/report");
    expect(engine.get(workflow.id)?.space.artifacts.length).toBe(3);
  });

  it("waits for human approval and resumes only after approval", async () => {
    const file = fixture(); let calls = 0;
    const engine = new WorkflowEngine(file, async () => (calls++, { ok: true }));
    const workflow = engine.create({ name: "审批", ownerBotId: "owner", objective: "目标", nodes: [
      { id: "approval", title: "发布", prompt: "发布", botId: "owner", approval: true },
    ] });
    engine.run(workflow.id);
    await waitFor(() => engine.get(workflow.id)?.status === "waiting_approval");
    expect(calls).toBe(0);
    expect(engine.approve(workflow.id, "approval")).not.toBeNull();
    await waitFor(() => engine.get(workflow.id)?.status === "completed");
    expect(calls).toBe(1);
  });

  it("auto retries recoverable safe failures but never retries side effects", async () => {
    const file = fixture(); const calls = new Map<string, number>();
    const engine = new WorkflowEngine(file, async (_workflow, node) => {
      const count = (calls.get(node.id) ?? 0) + 1; calls.set(node.id, count);
      if (node.id === "safe" && count === 1) return { ok: false, errorCode: "timeout", retryable: true, replaySafe: true };
      if (node.id === "side") return { ok: false, errorCode: "timeout", retryable: true, replaySafe: false };
      return { ok: true };
    });
    const workflow = engine.create({ name: "重试", ownerBotId: "owner", objective: "目标", nodes: [
      { id: "safe", title: "安全", prompt: "安全", botId: "one", maxRetries: 1 },
      { id: "side", title: "副作用", prompt: "副作用", botId: "two", maxRetries: 3 },
    ] });
    engine.run(workflow.id);
    await waitFor(() => engine.get(workflow.id)?.status === "failed");
    expect(calls.get("safe")).toBe(2);
    expect(calls.get("side")).toBe(1);
    expect(engine.retry(workflow.id, "side")).toBeNull();
  });

  it("supports failure branches, pause/cancel, shared space, and restart recovery", async () => {
    const file = fixture();
    const engine = new WorkflowEngine(file, async (_workflow, node) => ({ ok: node.id !== "bad", errorCode: node.id === "bad" ? "task_error" : undefined }));
    const workflow = engine.create({ name: "条件", ownerBotId: "owner", objective: "目标", nodes: [
      { id: "bad", title: "失败", prompt: "失败", botId: "one" },
      { id: "normal", title: "跳过", prompt: "跳过", botId: "two", dependsOn: ["bad"] },
      { id: "recover", title: "恢复", prompt: "恢复", botId: "owner", dependsOn: ["bad"], runIf: "any_failed" },
    ] });
    engine.patchSpace(workflow.id, { facts: ["已确认"] }); engine.run(workflow.id);
    await waitFor(() => engine.get(workflow.id)?.status === "failed");
    expect(engine.get(workflow.id)?.nodes.find((node) => node.id === "normal")?.status).toBe("skipped");
    expect(engine.get(workflow.id)?.nodes.find((node) => node.id === "recover")?.status).toBe("completed");
    expect(JSON.parse(readFileSync(file, "utf8"))[0].space.facts).toEqual(["已确认"]);

    const raw = engine.get(workflow.id)! as WorkflowRecord;
    raw.status = "running"; raw.nodes[0]!.status = "running"; writeFileSync(file, JSON.stringify([raw]));
    const recovered = new WorkflowEngine(file, async () => ({ ok: true }));
    await waitFor(() => recovered.get(workflow.id)?.status === "failed" || recovered.get(workflow.id)?.status === "completed");
    expect(recovered.get(workflow.id)?.nodes[0]?.status).not.toBe("running");
  });

  it("pauses before scheduling downstream work and propagates cancellation", async () => {
    const file = fixture(); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const calls: string[] = [];
    const engine = new WorkflowEngine(file, async (_workflow, node) => { calls.push(node.id); if (node.id === "first") await gate; return { ok: true }; });
    const workflow = engine.create({ name: "控制", ownerBotId: "owner", objective: "目标", nodes: [
      { id: "first", title: "一", prompt: "一", botId: "one" },
      { id: "second", title: "二", prompt: "二", botId: "two", dependsOn: ["first"] },
    ] });
    engine.run(workflow.id); await waitFor(() => engine.get(workflow.id)?.nodes[0]?.status === "running");
    engine.pause(workflow.id); release(); await waitFor(() => engine.get(workflow.id)?.nodes[0]?.status === "completed");
    expect(engine.get(workflow.id)?.status).toBe("paused"); expect(calls).toEqual(["first"]);
    engine.resume(workflow.id); await waitFor(() => engine.get(workflow.id)?.status === "completed"); expect(calls).toEqual(["first", "second"]);

    const cancelled = engine.create({ name: "取消", ownerBotId: "owner", objective: "目标", nodes: [{ id: "later", title: "后续", prompt: "后续", botId: "one", approval: true }] });
    engine.run(cancelled.id); await waitFor(() => engine.get(cancelled.id)?.status === "waiting_approval");
    engine.cancel(cancelled.id); expect(engine.get(cancelled.id)).toMatchObject({ status: "cancelled", nodes: [{ status: "cancelled" }] });
  });
});
