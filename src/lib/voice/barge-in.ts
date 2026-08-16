import { openVoiceMicrophone } from "./microphone";
import { VoiceActivityGate, voiceActivityOptions, type VoiceActivityProfile } from "./voice-activity";

export interface VoiceBargeInSettings extends Partial<VoiceActivityProfile> {
  deviceId?: string;
}

/** Lightweight, non-recording microphone monitor used for call barge-in.
 * Failure is silent because Space and the interrupt button remain available. */
export class VoiceBargeInDetector {
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private timer: number | null = null;

  async start(onVoice: () => void, settings: VoiceBargeInSettings = {}): Promise<void> {
    this.stop();
    const mine = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await openVoiceMicrophone(settings.deviceId);
      if (mine !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const gate = new VoiceActivityGate(voiceActivityOptions(settings));
      this.stream = stream;
      this.context = context;
      this.timer = window.setInterval(() => {
        if (mine !== this.generation) return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          energy += centered * centered;
        }
        if (!gate.update(Math.sqrt(energy / samples.length))) return;
        this.stop();
        onVoice();
      }, 50);
    } catch {
      // Manual interruption remains available.
    }
  }

  stop(): void {
    this.generation += 1;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
