export class VoiceConfigError extends Error {
    status = 409;
}
const DEFAULT_STT_MODEL = "whisper-1";
const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_TTS_VOICE = "alloy";
const DEFAULT_TTS_SPEED = 1;
const DEFAULT_TTS_GAIN = 0;
const DEFAULT_TTS_SAMPLE_RATE = 44_100;
const VOICE_INPUT_PRESETS = {
    low: { sensitivity: "low", minimumRms: 0.075, noiseRatio: 2.3, triggerFrames: 6 },
    medium: { sensitivity: "medium", minimumRms: 0.055, noiseRatio: 1.9, triggerFrames: 4 },
    high: { sensitivity: "high", minimumRms: 0.035, noiseRatio: 1.5, triggerFrames: 3 },
};
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const finite = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function ttsProvider(cfg, url) {
    if (cfg.voice?.tts?.provider === "siliconflow")
        return "siliconflow";
    if (cfg.voice?.tts?.provider === "openai")
        return "openai";
    try {
        return /(^|\.)siliconflow\.cn$/i.test(new URL(url).hostname) ? "siliconflow" : "openai";
    }
    catch {
        return /siliconflow\.cn/i.test(url) ? "siliconflow" : "openai";
    }
}
function endpoint(baseUrl, path) {
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith(path) ? base : `${base}${path}`;
}
function headers(key) {
    const value = clean(key);
    return value ? { authorization: `Bearer ${value}` } : {};
}
function inputProfile(raw) {
    const sensitivity = ["low", "medium", "high", "custom"].includes(String(raw?.sensitivity))
        ? raw.sensitivity
        : "medium";
    const preset = sensitivity === "custom" ? VOICE_INPUT_PRESETS.medium : VOICE_INPUT_PRESETS[sensitivity];
    const calibratedNoiseFloor = finite(raw?.calibratedNoiseFloor, Number.NaN);
    return {
        sensitivity,
        minimumRms: clamp(finite(raw?.minimumRms, preset.minimumRms), 0.01, 0.2),
        noiseRatio: clamp(finite(raw?.noiseRatio, preset.noiseRatio), 1.1, 4),
        triggerFrames: Math.round(clamp(finite(raw?.triggerFrames, preset.triggerFrames), 2, 12)),
        ...(Number.isFinite(calibratedNoiseFloor) ? { calibratedNoiseFloor: clamp(calibratedNoiseFloor, 0, 0.2) } : {}),
        ...(typeof raw?.calibratedAt === "string" ? { calibratedAt: raw.calibratedAt } : {}),
    };
}
function inputStatus(cfg) {
    const deviceId = clean(cfg.voice?.input?.deviceId) || "default";
    const profiles = {};
    for (const [id, profile] of Object.entries(cfg.voice?.input?.profiles ?? {}).slice(0, 32)) {
        const cleanId = clean(id);
        if (cleanId)
            profiles[cleanId] = inputProfile(profile);
    }
    const active = profiles[deviceId] ?? inputProfile();
    profiles[deviceId] ??= active;
    return { deviceId, profiles, ...active };
}
async function providerError(res, action) {
    let detail = "";
    try {
        const body = await res.json();
        detail = clean(body?.error?.message) || clean(body?.message) || clean(body?.detail);
    }
    catch {
        try {
            detail = (await res.text()).trim();
        }
        catch {
            /* ignore */
        }
    }
    const error = new Error(detail ? `${action}失败：${detail}` : `${action}失败（HTTP ${res.status}）`);
    error.status = res.status === 401 || res.status === 403 ? 401 : 502;
    return error;
}
export function describeVoice(cfg) {
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
        input: inputStatus(cfg),
        autoSpeak: cfg.voice?.autoSpeak === true,
    };
}
export async function transcribe(cfg, audio, mime = "audio/webm") {
    const status = describeVoice(cfg);
    if (!status.stt.configured)
        throw new VoiceConfigError("请先在应用设置中配置语音识别服务地址");
    if (!audio.length) {
        const error = new Error("录音内容为空");
        error.status = 400;
        throw error;
    }
    const form = new FormData();
    form.append("model", status.stt.model);
    if (status.stt.language)
        form.append("language", status.stt.language);
    const copy = new Uint8Array(audio.byteLength);
    copy.set(audio);
    form.append("file", new Blob([copy.buffer], { type: mime || "application/octet-stream" }), `recording.${mime.includes("wav") ? "wav" : "webm"}`);
    const res = await fetch(endpoint(status.stt.url, "/audio/transcriptions"), {
        method: "POST",
        headers: headers(cfg.voice?.stt?.key),
        body: form,
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok)
        throw await providerError(res, "语音识别");
    const body = await res.json().catch(() => null);
    const text = clean(body?.text);
    if (!text) {
        const error = new Error("语音识别服务没有返回文本");
        error.status = 502;
        throw error;
    }
    return text;
}
export async function synthesize(cfg, text, tuning = {}) {
    const status = describeVoice(cfg);
    if (!status.tts.configured)
        throw new VoiceConfigError("请先在应用设置中配置语音合成服务地址");
    const input = text.trim();
    if (!input) {
        const error = new Error("朗读文本不能为空");
        error.status = 400;
        throw error;
    }
    if (input.length > 1200) {
        const error = new Error("单次朗读文本不能超过 1200 个字符");
        error.status = 400;
        throw error;
    }
    const payload = {
        model: status.tts.model,
        voice: clean(tuning.voice) || status.tts.voice,
        input,
        response_format: "mp3",
        speed: clamp(finite(tuning.speed, status.tts.speed), 0.25, 4),
    };
    if (status.tts.provider === "siliconflow") {
        payload.gain = clamp(finite(tuning.gain, status.tts.gain), -10, 10);
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
    if (!res.ok)
        throw await providerError(res, "语音合成");
    return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mime: res.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg",
    };
}
