export interface RecordedVoice {
  blob: Blob;
  mime: string;
  durationMs: number;
  heardSound: boolean;
}

export interface RecorderOptions {
  /** Stop automatically after this much silence, once speech has started. */
  endpointMs?: number;
  /** Hard ceiling so a forgotten recorder cannot run forever. */
  maxDurationMs?: number;
  /** Stop an untouched call listen after this long and quietly retry. */
  noSpeechTimeoutMs?: number;
}

function preferredMime(): string | undefined {
  const choices = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return choices.find((mime) => MediaRecorder.isTypeSupported(mime));
}

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private heardSound = false;
  private manualStop = false;
  private cancelled = false;
  private settle: ((result: RecordedVoice | null) => void) | null = null;
  private stopped: Promise<RecordedVoice | null> | null = null;

  get active(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async start(options: RecorderOptions = {}): Promise<void> {
    if (this.mediaRecorder) throw new Error("录音已经开始");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("当前环境不支持麦克风录音");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.stream = stream;
    this.chunks = [];
    this.startedAt = performance.now();
    this.heardSound = false;
    this.manualStop = false;
    this.cancelled = false;

    const mime = preferredMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    this.mediaRecorder = recorder;
    this.stopped = new Promise((resolve) => {
      this.settle = resolve;
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    recorder.onerror = () => this.finish(null);
    recorder.onstop = () => {
      const durationMs = Math.max(0, performance.now() - this.startedAt);
      const blob = new Blob(this.chunks, { type: recorder.mimeType || mime || "audio/webm" });
      this.finish(
        this.cancelled
          ? null
          : { blob, mime: blob.type || "audio/webm", durationMs, heardSound: this.heardSound || this.manualStop },
      );
    };
    recorder.start(250);

    if (options.endpointMs || options.maxDurationMs || options.noSpeechTimeoutMs) {
      this.startEndpointer(options);
    }
  }

  waitForStop(): Promise<RecordedVoice | null> {
    return this.stopped ?? Promise.resolve(null);
  }

  async stop(manual = true): Promise<RecordedVoice | null> {
    const pending = this.waitForStop();
    this.manualStop ||= manual;
    if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    else if (this.mediaRecorder) this.finish(null);
    return pending;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    else this.finish(null);
  }

  private startEndpointer(options: RecorderOptions) {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(this.stream!).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let lastSoundAt = performance.now();
      this.context = context;
      this.timer = window.setInterval(() => {
        if (!this.active) return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          energy += centered * centered;
        }
        const rms = Math.sqrt(energy / samples.length);
        const now = performance.now();
        if (rms >= 0.025) {
          this.heardSound = true;
          lastSoundAt = now;
        }
        if (options.endpointMs && this.heardSound && now - lastSoundAt >= options.endpointMs) {
          void this.stop(false);
        } else if (options.noSpeechTimeoutMs && !this.heardSound && now - this.startedAt >= options.noSpeechTimeoutMs) {
          void this.stop(false);
        } else if (options.maxDurationMs && now - this.startedAt >= options.maxDurationMs) {
          void this.stop(false);
        }
      }, 100);
    } catch {
      // Recording still works when Web Audio is unavailable; only automatic
      // silence end-pointing is lost, and max duration is enforced below.
      if (options.maxDurationMs) this.timer = window.setTimeout(() => void this.stop(false), options.maxDurationMs);
    }
  }

  private finish(result: RecordedVoice | null) {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    void this.context?.close().catch(() => {});
    this.context = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    const settle = this.settle;
    this.settle = null;
    this.stopped = null;
    settle?.(result);
  }
}

export async function transcribeVoice(recording: RecordedVoice, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: {
      "content-type": recording.mime,
      "x-audio-mime": recording.mime,
    },
    body: recording.blob,
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `语音识别失败（HTTP ${res.status}）`);
  const text = body.text?.trim();
  if (!text) throw new Error("没有识别到可发送的文字");
  return text;
}
