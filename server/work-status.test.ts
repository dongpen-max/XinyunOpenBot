import { describe, expect, it } from "vitest";
import { deriveWorkStatus } from "../src/lib/work-status.ts";

const bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "测试机器人",
  title: "",
  description: "",
  notifications: false,
  color: "blue",
  unread: false,
  busy: true,
  modelSelection: { instanceId: "relay", model: "model" },
  messages: [],
} as any;

describe("deriveWorkStatus", () => {
  it("surfaces cloud lifecycle before generic busy state", () => {
    expect(deriveWorkStatus({ bot, messages: [], computerActivity: "waking" })).toMatchObject({
      kind: "computer",
      label: "正在唤醒云端 Box",
    });
  });

  it("surfaces a pending human decision", () => {
    const messages = [{
      id: "ask-1",
      role: "bot",
      kind: "options",
      at: Date.now(),
      card: { title: "是否继续？", subtitle: "", options: ["允许"], requestId: "request-1" },
    }] as any;
    expect(deriveWorkStatus({ bot, messages })).toMatchObject({ kind: "waiting", label: "等待你的确认" });
  });

  it("distinguishes computer tools from ordinary tools", () => {
    const messages = [{ id: "tool-1", role: "bot", kind: "activity", at: Date.now(), tool: { name: "mcp__computer__open_url" } }] as any;
    expect(deriveWorkStatus({ bot, messages })).toMatchObject({ kind: "computer", detail: "打开网页" });
  });

  it("reports streaming output after tool activity settles", () => {
    const messages = [{ id: "tool-1", role: "bot", kind: "activity", at: Date.now(), tool: { name: "bash", ok: true } }] as any;
    expect(deriveWorkStatus({ bot, messages, streaming: "正在回答" })).toMatchObject({ kind: "writing", label: "正在生成回复" });
  });
});
