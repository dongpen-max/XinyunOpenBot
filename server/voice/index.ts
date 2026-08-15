import type { AppConfig } from "../config.ts";

export interface VoiceStatus {
  stt: {
    configured: boolean;
    keyConfigured: boolean;
    url: string;
    model: string;
    language: string;
  };
  tts: {
    configured: boolean;
    keyConfigured: boolean;
    url: string;
    model: string;
    voice: string;
    provider: "openai" | "siliconflow";
    speed: number;
    gain: number;
    sampleRate: number;
  };
  autoSpeak: boolean;
}

export interface VoiceAudio {
  bytes: Uint8Array;
  mime: string;
}

export class VoiceConfigError extends Error {
  readonly status = 409;
}

const DEFAULT_STT_MODEL = "whisper-1";
const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_TTS_VOICE = "alloy";
const DEFAULT_TTS_SPEED = 1;
const DEFAULT_TTS_GAIN = 0;
const DEFAULT_TTS_SAMPLE_RATE = 44_100;

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function ttsProvider(cfg: AppConfig, url: string): "openai" | "siliconflow" {
  if (cfg.voice?.tts?.provider === "siliconflow") return "siliconflow";
  if (cfg.voice?.tts?.provider === "openai") return "openai";
  try {
    return /(^|\.)siliconflow\.cn$/i.test(new URL(url).hostname) ? "siliconflow" : "openai";
  } catch {
    return /siliconflow\.cn/i.test(url) ? "siliconflow" : "openai";
  }
}

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith(path) ? base : `${base}${path}`;
}

function headers(key?: string): Record<string, string> {
  const value = clean(key);
  return value ? { authorization: `Bearer ${value}` } : {};
}

async function providerError(res: Response, action: string): Promise<Error> {
  let detail = "";
  try {
    const body: any = await res.json();
    detail = clean(body?.error?.message) || clean(body?.message) || clean(body?.detail);
  } catch {
    try {
      detail = (await res.text()).trim();
    } catch {
      /* ignore */
    }
  }
  const error = new Error(detail ? `${action}失败：${detail}` : `${action}失败（HTTP ${res.status}）`);
  (error as Error & { status?: number }).status = res.status === 401 || res.status === 403 ? 401 : 502;
  return error;
}

export function describeVoice(cfg: AppConfig): VoiceStatus {
  const sttUrl = clean(cfg.voice?.stt?.url);
  const ttsUrl = clean(cfg.voice?.tts?.url);
  const provider = ttsProvider(cfg, ttsUrl);
  return {
    stt: {
      configured: Boolean(sttUrl),
      keyConfigured: Boolean(clean(cfg.voice?.stt?.key)),
      url: sttUrl,
      model: clean(cfg.voice?.stt?.model) || DEFAULT_STT_MODEL,
      language: clean(cfg.voice?.stt?.language) || "zh",
    },
    tts: {
      configured: Boolean(ttsUrl),
      keyConfigured: Boolean(clean(cfg.voice?.tts?.key)),
      url: ttsUrl,
      model: clean(cfg.voice?.tts?.model) || DEFAULT_TTS_MODEL,
      voice: clean(cfg.voice?.tts?.voice) || DEFAULT_TTS_VOICE,
      provider,
      speed: clamp(finite(cfg.voice?.tts?.speed, DEFAULT_TTS_SPEED), 0.25, 4),
      gain: clamp(finite(cfg.voice?.tts?.gain, DEFAULT_TTS_GAIN), -10, 10),
      sampleRate: clamp(Math.round(finite(cfg.voice?.tts?.sampleRate, DEFAULT_TTS_SAMPLE_RATE)), 8_000, 48_000),
    },
    autoSpeak: cfg.voice?.autoSpeak === true,
  };
}

export async function transcribe(
  cfg: AppConfig,
  audio: Uint8Array,
  mime = "audio/webm",
): Promise<string> {
  const status = describeVoice(cfg);
  if (!status.stt.configured) throw new VoiceConfigError("请先在应用设置中配置语音识别服务地址");
  if (!audio.length) {
    const error = new Error("录音内容为空");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  const form = new FormData();
  form.append("model", status.stt.model);
  if (status.stt.language) form.append("language", status.stt.language);
  const copy = new Uint8Array(audio.byteLength);
  copy.set(audio);
  form.append("file", new Blob([copy.buffer], { type: mime || "application/octet-stream" }), `recording.${mime.includes("wav") ? "wav" : "webm"}`);
  const res = await fetch(endpoint(status.stt.url, "/audio/transcriptions"), {
    method: "POST",
    headers: headers(cfg.voice?.stt?.key),
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw await providerError(res, "语音识别");
  const body: any = await res.json().catch(() => null);
  const text = clean(body?.text);
  if (!text) {
    const error = new Error("语音识别服务没有返回文本");
    (error as Error & { status?: number }).status = 502;
    throw error;
  }
  return text;
}

export async function synthesize(cfg: AppConfig, text: string): Promise<VoiceAudio> {
  const status = describeVoice(cfg);
  if (!status.tts.configured) throw new VoiceConfigError("请先在应用设置中配置语音合成服务地址");
  const input = text.trim();
  if (!input) {
    const error = new Error("朗读文本不能为空");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  if (input.length > 1200) {
    const error = new Error("单次朗读文本不能超过 1200 个字符");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  const payload: Record<string, unknown> = {
    model: status.tts.model,
    voice: status.tts.voice,
    input,
    response_format: "mp3",
    speed: status.tts.speed,
  };
  if (status.tts.provider === "siliconflow") {
    payload.gain = status.tts.gain;
    payload.sample_rate = status.tts.sampleRate;
  }

  const res = await fetch(endpoint(status.tts.url, "/audio/speech"), {
    method: "POST",
    headers: {
      ...headers(cfg.voice?.tts?.key),
      "content-type": "application/json",
      accept: "audio/mpeg,audio/*",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw await providerError(res, "语音合成");
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg",
  };
}
