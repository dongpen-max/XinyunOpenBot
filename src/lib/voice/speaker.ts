import { useSyncExternalStore } from "react";

export type SpeechStatus = "idle" | "preparing" | "speaking";

export interface SpeechSnapshot {
  status: SpeechStatus;
  botId?: string;
  messageId?: string;
  caption?: string;
  error?: string;
}

export interface SpeakOptions {
  botId?: string;
  messageId?: string;
  tuning?: {
    voice?: string;
    speed?: number;
    gain?: number;
  };
}

const IDLE: SpeechSnapshot = { status: "idle" };

export class VoiceSpeaker {
  private snapshot: SpeechSnapshot = IDLE;
  private watchers = new Set<() => void>();
  private generation = 0;
  private request: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private settlePlayback: ((finished: boolean) => void) | null = null;

  get state(): SpeechSnapshot {
    return this.snapshot;
  }

  subscribe = (watcher: () => void): (() => void) => {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  };

  isSpeaking(messageId?: string): boolean {
    if (this.snapshot.status === "idle") return false;
    return messageId ? this.snapshot.messageId === messageId : true;
  }

  stop() {
    this.generation += 1;
    this.request?.abort();
    this.request = null;
    if (this.settlePlayback) this.settlePlayback(false);
    else this.teardownAudio();
    this.set(IDLE);
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<boolean> {
    this.stop();
    const mine = this.generation;
    const controller = new AbortController();
    this.request = controller;
    const live = () => mine === this.generation && !controller.signal.aborted;
    this.set({ status: "preparing", botId: options.botId, messageId: options.messageId });

    try {
      const utterances = await this.prepare(text, controller.signal);
      if (!live() || !utterances.length) return false;
      type Rendered = { blob: Blob } | { error: unknown };
      const render = (utterance: string): Promise<Rendered> =>
        this.render(utterance, controller.signal, options).then((blob) => ({ blob }), (error) => ({ error }));
      let next: Promise<Rendered> | null = render(utterances[0]);
      for (let index = 0; index < utterances.length; index += 1) {
        const current = next;
        next = index + 1 < utterances.length ? render(utterances[index + 1]) : null;
        if (!current) break;
        const rendered = await current;
        if ("error" in rendered) throw rendered.error;
        if (!live()) return false;
        this.set({
          status: "speaking",
          botId: options.botId,
          messageId: options.messageId,
          caption: utterances[index],
        });
        if (!(await this.play(rendered.blob, live)) || !live()) return false;
      }
      if (live()) this.set(IDLE);
      return live();
    } catch (error) {
      if (live()) this.set({ ...IDLE, error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      if (this.request === controller) this.request = null;
    }
  }

  private set(snapshot: SpeechSnapshot) {
    this.snapshot = snapshot;
    for (const watcher of this.watchers) watcher();
  }

  private async prepare(text: string, signal: AbortSignal): Promise<string[]> {
    const res = await fetch("/api/voice/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as { utterances?: string[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? `语音准备失败（HTTP ${res.status}）`);
    return body.utterances ?? [];
  }

  private async render(text: string, signal: AbortSignal, options: SpeakOptions): Promise<Blob> {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, botId: options.botId, tuning: options.tuning }),
      signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `语音合成失败（HTTP ${res.status}）`);
    }
    return res.blob();
  }

  private play(blob: Blob, live: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      if (!live()) return resolve(false);
      this.teardownAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      this.objectUrl = url;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.settlePlayback === done) this.settlePlayback = null;
        if (this.audio === audio) this.teardownAudio();
        resolve(ok);
      };
      this.settlePlayback = done;
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.play().catch(() => done(false));
    });
  }

  private teardownAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

export const voiceSpeaker = new VoiceSpeaker();

export function useVoiceSpeech(): SpeechSnapshot {
  return useSyncExternalStore(voiceSpeaker.subscribe, () => voiceSpeaker.state, () => voiceSpeaker.state);
}
