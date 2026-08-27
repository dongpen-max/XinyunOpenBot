import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeEvent } from "./contracts.ts";
import { TaskTraceStore } from "./task-trace.ts";

const dirs: string[] = [];
const store = () => { const dir = mkdtempSync(join(tmpdir(), "omb-traces-")); dirs.push(dir); return { dir, value: new TaskTraceStore(dir) }; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("TaskTraceStore", () => {
  it("persists lifecycle, queue wait, attempts, failover and usage", () => {
    const { value } = store();
    const trace = value.create({ threadId: "thread-1", botId: "bot-1", userMessageId: "message-1" });
    value.start(trace.id, "root-1");
    value.attempt(trace.id, { instanceId: "one", model: "fast" });
    value.failover(trace.id, { instanceId: "one", model: "fast" }, { instanceId: "two", model: "good" }, "timeout");
    value.runtime(trace.id, { type: "thread.token-usage.updated", input: 12, output: 3, eventId: "e", provider: "p", threadId: "thread-1", createdAt: new Date().toISOString() });
    value.finish(trace.id, "completed");
    const settled = value.get(trace.id)!;
    expect(settled.status).toBe("completed");
    expect(settled.queueWaitMs).toBeGreaterThanOrEqual(0);
    expect(settled.attempts).toEqual([{ instanceId: "one", model: "fast" }]);
    expect(settled.failovers).toBe(1);
    expect(settled.usage).toEqual({ input: 12, output: 3 });
  });

  it("records tool metadata without input, output, raw event or credentials", () => {
    const { dir, value } = store();
    const trace = value.create({ threadId: "t", botId: "b", userMessageId: "m" });
    const event = { type: "item.started", itemType: "tool", title: "search Authorization: Bearer top-secret", raw: { source: "native", payload: { token: "top-secret" } }, eventId: "1", provider: "p", threadId: "t", createdAt: new Date().toISOString() } as RuntimeEvent;
    value.runtime(trace.id, event);
    const disk = readFileSync(join(dir, `${trace.id}.json`), "utf8");
    expect(disk).not.toContain("top-secret");
    expect(disk).not.toContain("payload");
    expect(disk).toContain("[redacted]");
  });

  it("blocks replay after cancellation, tools, or computer use", () => {
    const { value } = store();
    const cancelled = value.create({ threadId: "t", botId: "b", userMessageId: "m" });
    value.finish(cancelled.id, "cancelled", "cancelled");
    expect(value.canReplay(cancelled.id)).toMatchObject({ ok: false });
    const tool = value.create({ threadId: "t", botId: "b", userMessageId: "m" });
    value.tool(tool.id, "submit");
    expect(value.canReplay(tool.id).reason).toContain("工具");
    const computer = value.create({ threadId: "t", botId: "b", userMessageId: "m" });
    value.computer(computer.id, "电脑");
    expect(value.canReplay(computer.id).reason).toContain("电脑");
  });

  it("exports only the explicit redacted diagnostic schema", () => {
    const { value } = store();
    const trace = value.create({ threadId: "t", botId: "b", userMessageId: "secret-message-id" });
    (trace as any).authorization = "Bearer secret";
    (trace as any).prompt = "private prompt";
    const exported = JSON.stringify(value.export(trace.id));
    expect(exported).not.toContain("authorization");
    expect(exported).not.toContain("private prompt");
    expect(exported).not.toContain("secret-message-id");
  });

  it("settles an interrupted trace after restart instead of leaving it running", () => {
    const { dir, value } = store();
    const trace = value.create({ threadId: "t", botId: "b", userMessageId: "m" });
    value.start(trace.id);
    const reloaded = new TaskTraceStore(dir);
    expect(reloaded.get(trace.id)).toMatchObject({ status: "failed", errorCode: "connection_lost" });
  });
});
