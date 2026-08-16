export interface MicrophoneSample {
  rms: number;
  at: number;
}

export function voiceAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
  };
}

export async function openVoiceMicrophone(deviceId?: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: voiceAudioConstraints(deviceId) });
  } catch (error) {
    if (!deviceId || deviceId === "default") throw error;
    return navigator.mediaDevices.getUserMedia({ audio: voiceAudioConstraints() });
  }
}

export async function listVoiceMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
}

export class MicrophoneLevelMonitor {
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private timer: number | null = null;

  async start(deviceId: string | undefined, onSample: (sample: MicrophoneSample) => void): Promise<void> {
    this.stop();
    const mine = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前环境不支持麦克风检测");
    const stream = await openVoiceMicrophone(deviceId);
    if (mine !== this.generation) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
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
      onSample({ rms: Math.sqrt(energy / samples.length), at: performance.now() });
    }, 50);
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
