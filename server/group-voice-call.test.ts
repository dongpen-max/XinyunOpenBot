import { describe, expect, it } from "vitest";

import { collectGroupCallReplies, type GroupCallMessage } from "../src/lib/voice/group-call.ts";

const message = (patch: Partial<GroupCallMessage> & Pick<GroupCallMessage, "id">): GroupCallMessage => ({
  role: "bot",
  kind: "text",
  text: "reply",
  from: { botId: "bot-a" },
  ...patch,
  id: patch.id,
});

describe("group call reply collection", () => {
  it("skips every message that existed before the call started", () => {
    const messages = [message({ id: "old-a" }), message({ id: "old-b", from: { botId: "bot-b" } })];
    const result = collectGroupCallReplies(messages, new Set(messages.map((item) => item.id)));

    expect(result.replies).toEqual([]);
  });

  it("queues only new bot text in transcript order and keeps each sender", () => {
    const messages: GroupCallMessage[] = [
      message({ id: "old" }),
      message({ id: "user", role: "user", from: undefined, text: "question" }),
      message({ id: "activity", kind: "activity", text: undefined }),
      message({ id: "blank", text: "   " }),
      message({ id: "anonymous", from: undefined }),
      message({ id: "reply-a", text: " first ", from: { botId: "bot-a" } }),
      message({ id: "reply-b", text: "second", from: { botId: "bot-b" } }),
    ];

    const result = collectGroupCallReplies(messages, new Set(["old"]));

    expect(result.replies).toEqual([
      { messageId: "reply-a", botId: "bot-a", text: "first" },
      { messageId: "reply-b", botId: "bot-b", text: "second" },
    ]);
  });

  it("does not enqueue the same message twice across transcript refreshes", () => {
    const first = collectGroupCallReplies([message({ id: "reply-a" })], new Set());
    const second = collectGroupCallReplies(
      [message({ id: "reply-a" }), message({ id: "reply-b", from: { botId: "bot-b" } })],
      first.seenMessageIds,
    );

    expect(first.replies.map((item) => item.messageId)).toEqual(["reply-a"]);
    expect(second.replies).toEqual([{ messageId: "reply-b", botId: "bot-b", text: "reply" }]);
  });

  it("marks skipped messages as seen so they remain skipped", () => {
    const skipped = message({ id: "user", role: "user", from: undefined, text: "hello" });
    const first = collectGroupCallReplies([skipped], new Set());
    const second = collectGroupCallReplies([skipped], first.seenMessageIds);

    expect(first.replies).toEqual([]);
    expect(second.replies).toEqual([]);
    expect(second.seenMessageIds.has("user")).toBe(true);
  });
});
