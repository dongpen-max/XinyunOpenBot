import { describe, expect, it } from "vitest";

import { VoiceActivityGate } from "../src/lib/voice/voice-activity.ts";
import { SpeechTurnQueue } from "../src/lib/voice/speech-queue.ts";

describe("voice barge-in activity gate", () => {
  it("ignores playback leakage and triggers on sustained nearby speech", () => {
    const gate = new VoiceActivityGate({ warmupFrames: 4, triggerFrames: 3, minimumRms: 0.05, noiseRatio: 1.8 });
    expect([0.02, 0.021, 0.019, 0.022].map((sample) => gate.update(sample))).not.toContain(true);
    expect(gate.update(0.08)).toBe(false);
    expect(gate.update(0.085)).toBe(false);
    expect(gate.update(0.09)).toBe(true);
  });

  it("requires consecutive voice frames instead of reacting to one click", () => {
    const gate = new VoiceActivityGate({ warmupFrames: 2, triggerFrames: 2, minimumRms: 0.04 });
    gate.update(0.01);
    gate.update(0.01);
    expect(gate.update(0.09)).toBe(false);
    expect(gate.update(0.01)).toBe(false);
    expect(gate.update(0.09)).toBe(false);
    expect(gate.update(0.09)).toBe(true);
  });
});

describe("SpeechTurnQueue", () => {
  it("keeps FIFO order inside one call turn", () => {
    const queue = new SpeechTurnQueue<string>();
    queue.enqueue(["一", "二", "三"]);
    expect([queue.shift(), queue.shift(), queue.shift()]).toEqual(["一", "二", "三"]);
  });

  it("drops audio produced by a stale turn after interruption", () => {
    const queue = new SpeechTurnQueue<string>();
    const old = queue.epoch;
    queue.enqueue(["旧回答"], old);
    queue.invalidate();
    expect(queue.enqueue(["迟到的旧音频"], old)).toBe(0);
    queue.enqueue(["新回答"]);
    expect(queue.shift()).toBe("新回答");
  });
});
