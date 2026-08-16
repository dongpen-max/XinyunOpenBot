export interface VoiceActivityOptions {
  warmupFrames?: number;
  triggerFrames?: number;
  minimumRms?: number;
  noiseRatio?: number;
}

export type VoiceSensitivity = "low" | "medium" | "high" | "custom";

export interface VoiceActivityProfile {
  sensitivity: VoiceSensitivity;
  minimumRms: number;
  noiseRatio: number;
  triggerFrames: number;
  calibratedNoiseFloor?: number;
  calibratedAt?: string;
}

export interface VoiceInputStatus extends VoiceActivityProfile {
  deviceId: string;
  profiles: Record<string, VoiceActivityProfile>;
}

export const VOICE_ACTIVITY_PRESETS: Record<Exclude<VoiceSensitivity, "custom">, VoiceActivityProfile> = {
  low: { sensitivity: "low", minimumRms: 0.075, noiseRatio: 2.3, triggerFrames: 6 },
  medium: { sensitivity: "medium", minimumRms: 0.055, noiseRatio: 1.9, triggerFrames: 4 },
  high: { sensitivity: "high", minimumRms: 0.035, noiseRatio: 1.5, triggerFrames: 3 },
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function normalizeVoiceActivityProfile(profile?: Partial<VoiceActivityProfile>): VoiceActivityProfile {
  const sensitivity = profile?.sensitivity ?? "medium";
  const preset = sensitivity === "custom" ? VOICE_ACTIVITY_PRESETS.medium : VOICE_ACTIVITY_PRESETS[sensitivity];
  return {
    sensitivity,
    minimumRms: clamp(Number.isFinite(profile?.minimumRms) ? profile!.minimumRms! : preset.minimumRms, 0.01, 0.2),
    noiseRatio: clamp(Number.isFinite(profile?.noiseRatio) ? profile!.noiseRatio! : preset.noiseRatio, 1.1, 4),
    triggerFrames: Math.round(clamp(Number.isFinite(profile?.triggerFrames) ? profile!.triggerFrames! : preset.triggerFrames, 2, 12)),
    ...(Number.isFinite(profile?.calibratedNoiseFloor)
      ? { calibratedNoiseFloor: clamp(profile!.calibratedNoiseFloor!, 0, 0.2) }
      : {}),
    ...(typeof profile?.calibratedAt === "string" ? { calibratedAt: profile.calibratedAt } : {}),
  };
}

export function voiceActivityOptions(profile?: Partial<VoiceActivityProfile>): VoiceActivityOptions {
  const normalized = normalizeVoiceActivityProfile(profile);
  return {
    warmupFrames: 8,
    minimumRms: normalized.minimumRms,
    noiseRatio: normalized.noiseRatio,
    triggerFrames: normalized.triggerFrames,
  };
}

export function calibrateVoiceActivity(
  samples: readonly number[],
  profile?: Partial<VoiceActivityProfile>,
): { noiseFloor: number; peakRms: number; minimumRms: number } {
  const clean = samples.filter((sample) => Number.isFinite(sample) && sample >= 0).sort((a, b) => a - b);
  const normalized = normalizeVoiceActivityProfile(profile);
  if (!clean.length) {
    return { noiseFloor: 0, peakRms: 0, minimumRms: normalized.minimumRms };
  }
  const percentile = (ratio: number) => clean[Math.min(clean.length - 1, Math.floor((clean.length - 1) * ratio))]!;
  const noiseFloor = percentile(0.7);
  const peakRms = percentile(0.95);
  const margin = normalized.sensitivity === "high" ? 1.12 : normalized.sensitivity === "low" ? 1.4 : 1.25;
  return {
    noiseFloor,
    peakRms,
    minimumRms: clamp(Math.max(normalized.minimumRms, peakRms * margin + 0.004), 0.01, 0.2),
  };
}

/** Conservative voice-activity gate used only while TTS is playing. */
export class VoiceActivityGate {
  private frame = 0;
  private hotFrames = 0;
  private floor = 0;
  private fired = false;
  private readonly warmupFrames: number;
  private readonly triggerFrames: number;
  private readonly minimumRms: number;
  private readonly noiseRatio: number;
  private threshold = 0;

  constructor({
    warmupFrames = 8,
    triggerFrames = 4,
    minimumRms = 0.055,
    noiseRatio = 1.9,
  }: VoiceActivityOptions = {}) {
    this.warmupFrames = Math.max(1, warmupFrames);
    this.triggerFrames = Math.max(1, triggerFrames);
    this.minimumRms = Math.max(0, minimumRms);
    this.noiseRatio = Math.max(1, noiseRatio);
  }

  update(rms: number): boolean {
    if (this.fired || !Number.isFinite(rms) || rms < 0) return this.fired;
    this.frame += 1;
    if (this.frame <= this.warmupFrames) {
      this.floor = this.frame === 1 ? rms : this.floor * 0.75 + rms * 0.25;
      return false;
    }
    const threshold = Math.max(this.minimumRms, this.floor * this.noiseRatio);
    this.threshold = threshold;
    if (rms >= threshold) this.hotFrames += 1;
    else {
      this.hotFrames = 0;
      this.floor = this.floor * 0.96 + rms * 0.04;
    }
    if (this.hotFrames >= this.triggerFrames) this.fired = true;
    return this.fired;
  }

  get diagnostics(): { threshold: number; noiseFloor: number; hotFrames: number; fired: boolean } {
    return { threshold: this.threshold || this.minimumRms, noiseFloor: this.floor, hotFrames: this.hotFrames, fired: this.fired };
  }
}
