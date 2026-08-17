import { describe, expect, it } from "vitest";

import { SseReplayBuffer } from "./sse-replay.ts";

const payload = (frame: string) => JSON.parse(frame.match(/data: (.+)\n\n$/s)?.[1] ?? "null");

describe("SseReplayBuffer", () => {
  it("numbers frames and replays a disconnected client's gap", () => {
    const replay = new SseReplayBuffer("12345678", 10);
    const first = replay.append({ kind: "bot", value: 1 });
    replay.append({ kind: "bot", value: 2 });
    replay.append({ kind: "message", value: 3 });

    const resumed = replay.resume(`12345678:${first.seq}`);
    expect(resumed.resumed).toBe(true);
    expect(resumed.frames.map(payload).map((frame) => frame.seq)).toEqual([2, 3]);
  });

  it("rejects stale, malformed, foreign-run, and future cursors", () => {
    const replay = new SseReplayBuffer("12345678", 2);
    replay.append({ kind: "bot" });
    replay.append({ kind: "bot" });
    replay.append({ kind: "bot" });

    for (const cursor of [null, "bad", "deadbeef:1", "12345678:0", "12345678:999"]) {
      expect(replay.resume(cursor).resumed).toBe(false);
    }
  });

  it("does not retain live screen payloads", () => {
    const replay = new SseReplayBuffer("12345678", 10);
    replay.append({ kind: "screen", png: "large-secret-frame" });
    replay.append({ kind: "bot", value: 2 });

    const resumed = replay.resume("12345678:0");
    expect(resumed.resumed).toBe(true);
    expect(resumed.frames.join("\n")).not.toContain("large-secret-frame");
    expect(resumed.frames.map(payload).map((frame) => frame.kind)).toEqual(["bot"]);
  });

  it("filters replayed frame kinds for clients that opt out", () => {
    const replay = new SseReplayBuffer("12345678", 10);
    replay.append({ kind: "runtime" });
    replay.append({ kind: "message" });

    const resumed = replay.resume("12345678:0", (kind) => kind !== "runtime");
    expect(resumed.frames.map(payload).map((frame) => frame.kind)).toEqual(["message"]);
  });
});
