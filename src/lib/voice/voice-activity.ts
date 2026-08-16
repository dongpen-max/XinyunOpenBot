export interface VoiceActivityOptions {
  warmupFrames?: number;
  triggerFrames?: number;
  minimumRms?: number;
  noiseRatio?: number;
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
    if (rms >= threshold) this.hotFrames += 1;
    else {
      this.hotFrames = 0;
      this.floor = this.floor * 0.96 + rms * 0.04;
    }
    if (this.hotFrames >= this.triggerFrames) this.fired = true;
    return this.fired;
  }
}
