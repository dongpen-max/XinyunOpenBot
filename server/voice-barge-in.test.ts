import { describe, expect, it } from "vitest";

import {
  calibrateVoiceActivity,
  normalizeVoiceActivityProfile,
  VOICE_ACTIVITY_PRESETS,
  VoiceActivityGate,
  voiceActivityOptions,
} from "../src/lib/voice/voice-activity.ts";
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

  it("maps sensitivity presets to distinct thresholds and trigger delays", () => {
    expect(VOICE_ACTIVITY_PRESETS.high.minimumRms).toBeLessThan(VOICE_ACTIVITY_PRESETS.medium.minimumRms);
    expect(VOICE_ACTIVITY_PRESETS.medium.minimumRms).toBeLessThan(VOICE_ACTIVITY_PRESETS.low.minimumRms);
    expect(VOICE_ACTIVITY_PRESETS.high.triggerFrames).toBeLessThan(VOICE_ACTIVITY_PRESETS.low.triggerFrames);
    expect(voiceActivityOptions({ sensitivity: "high" })).toMatchObject({
      minimumRms: 0.035,
      noiseRatio: 1.5,
      triggerFrames: 3,
    });
  });

  it("calibrates above sustained speaker leakage without exceeding safe bounds", () => {
    const leakage = [0.018, 0.021, 0.02, 0.024, 0.027, 0.025, 0.026, 0.03, 0.029, 0.028];
    const result = calibrateVoiceActivity(leakage, VOICE_ACTIVITY_PRESETS.high);
    expect(result.noiseFloor).toBeGreaterThan(0.02);
    expect(result.minimumRms).toBeGreaterThan(result.peakRms);
    expect(result.minimumRms).toBeLessThanOrEqual(0.2);
  });

  it("normalizes custom values and exposes the live threshold", () => {
    const profile = normalizeVoiceActivityProfile({
      sensitivity: "custom",
      minimumRms: 0.08,
      noiseRatio: 2.5,
      triggerFrames: 5,
    });
    const gate = new VoiceActivityGate(voiceActivityOptions(profile));
    for (let index = 0; index < 8; index += 1) gate.update(0.02);
    gate.update(0.09);
    expect(gate.diagnostics.threshold).toBe(0.08);
    expect(gate.diagnostics.hotFrames).toBe(1);
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
