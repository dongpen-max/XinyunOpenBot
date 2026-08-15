import { Check, Loader2, Mic, RotateCcw, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { voiceSpeaker, useVoiceSpeech } from "@/lib/voice/speaker";

type VoiceProvider = "openai" | "siliconflow";

const SAMPLE = "你好，我是星云机器人。现在正在试听你选择的音色和语速。";
const SILICONFLOW_MODEL = "FunAudioLLM/CosyVoice2-0.5B";
const SILICONFLOW_VOICES = [
  ["alex", "Alex · 沉稳男声"],
  ["benjamin", "Benjamin · 低沉男声"],
  ["charles", "Charles · 磁性男声"],
  ["david", "David · 活泼男声"],
  ["anna", "Anna · 沉稳女声"],
  ["bella", "Bella · 热情女声"],
  ["claire", "Claire · 温柔女声"],
  ["diana", "Diana · 活泼女声"],
] as const;
const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const inputClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

export function VoiceSettings() {
  const { state, dispatch } = useStore();
  const status = state.config?.voice;
  const speech = useVoiceSpeech();
  const [sttUrl, setSttUrl] = useState("");
  const [sttKey, setSttKey] = useState("");
  const [sttModel, setSttModel] = useState("whisper-1");
  const [language, setLanguage] = useState("zh");
  const [ttsUrl, setTtsUrl] = useState("");
  const [ttsKey, setTtsKey] = useState("");
  const [ttsModel, setTtsModel] = useState("tts-1");
  const [voice, setVoice] = useState("alloy");
  const [provider, setProvider] = useState<VoiceProvider>("openai");
  const [speed, setSpeed] = useState(1);
  const [gain, setGain] = useState(0);
  const [sampleRate, setSampleRate] = useState(44_100);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    setSttUrl(status.stt.url);
    setSttModel(status.stt.model);
    setLanguage(status.stt.language);
    setTtsUrl(status.tts.url);
    setTtsModel(status.tts.model);
    setVoice(status.tts.voice);
    setProvider(status.tts.provider);
    setSpeed(status.tts.speed);
    setGain(status.tts.gain);
    setSampleRate(status.tts.sampleRate);
    setAutoSpeak(status.autoSpeak);
  }, [status]);

  const chooseProvider = (next: VoiceProvider) => {
    setProvider(next);
    if (next === "siliconflow") {
      if (!ttsModel.trim() || ttsModel === "tts-1" || ttsModel.startsWith("gpt-")) setTtsModel(SILICONFLOW_MODEL);
      if (!voice.trim() || OPENAI_VOICES.includes(voice)) setVoice(`${SILICONFLOW_MODEL}:anna`);
    } else {
      if (ttsModel.startsWith("FunAudioLLM/")) setTtsModel("tts-1");
      if (voice.startsWith("FunAudioLLM/")) setVoice("alloy");
    }
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const stt: Record<string, string> = {
        url: sttUrl.trim(),
        model: sttModel.trim(),
        language: language.trim(),
      };
      const tts: Record<string, string | number> = {
        url: ttsUrl.trim(),
        model: ttsModel.trim(),
        voice: voice.trim(),
        provider,
        speed,
        gain,
        sampleRate,
      };
      if (sttKey.trim()) stt.key = sttKey.trim();
      if (ttsKey.trim()) tts.key = ttsKey.trim();
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice: { stt, tts, autoSpeak } }),
      });
      const body = (await res.json().catch(() => ({}))) as ConfigStatus & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `保存失败（HTTP ${res.status}）`);
      dispatch({ type: "configStatus", config: body });
      setSttKey("");
      setTtsKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (voiceSpeaker.isSpeaking()) return voiceSpeaker.stop();
    if (await save()) await voiceSpeaker.speak(SAMPLE);
  };

  const voiceOptions = provider === "siliconflow"
    ? SILICONFLOW_VOICES.map(([id, label]) => ({ value: `${SILICONFLOW_MODEL}:${id}`, label }))
    : OPENAI_VOICES.map((value) => ({ value, label: value }));

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Mic size={18} />
        </span>
        <div>
          <div className="text-[15px] font-medium text-ink">语音聊天</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
            调整识别服务、音色、语速和音量。密钥只保存在本机配置中。
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="text-[13px] font-medium text-ink">语音识别（STT）</div>
        <input className={inputClass} value={sttUrl} onChange={(e) => setSttUrl(e.target.value)} placeholder="https://api.example.com/v1" aria-label="STT URL" />
        <input className={inputClass} type="password" value={sttKey} onChange={(e) => setSttKey(e.target.value)} autoComplete="off" placeholder={status?.stt.keyConfigured ? "••••••••（留空保持原密钥）" : "STT API Key（本地服务可留空）"} aria-label="STT API Key" />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} value={sttModel} onChange={(e) => setSttModel(e.target.value)} placeholder="whisper-1" aria-label="STT 模型" />
          <input className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="zh" aria-label="识别语言" />
        </div>

        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink">语音合成（TTS）</span>
          <select value={provider} onChange={(e) => chooseProvider(e.target.value as VoiceProvider)} className="rounded-md border border-hairline/40 bg-inset px-2 py-1 text-[12px] text-ink focus:outline-none" aria-label="TTS 服务类型">
            <option value="siliconflow">硅基流动</option>
            <option value="openai">OpenAI 兼容</option>
          </select>
        </div>
        <input className={inputClass} value={ttsUrl} onChange={(e) => setTtsUrl(e.target.value)} placeholder="https://api.example.com/v1" aria-label="TTS URL" />
        <input className={inputClass} type="password" value={ttsKey} onChange={(e) => setTtsKey(e.target.value)} autoComplete="off" placeholder={status?.tts.keyConfigured ? "••••••••（留空保持原密钥）" : "TTS API Key（本地服务可留空）"} aria-label="TTS API Key" />
        <input className={inputClass} value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} placeholder="TTS 模型" aria-label="TTS 模型" />
        <div>
          <label className="mb-1.5 block text-[12px] text-ink-secondary" htmlFor="tts-voice">音色</label>
          <input id="tts-voice" list="tts-voice-options" className={inputClass} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="选择或填写音色 URI" aria-label="TTS 声音" />
          <datalist id="tts-voice-options">
            {voiceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </datalist>
          <div className="mt-1 text-[11px] text-ink-secondary">可以从列表选择，也可以粘贴自定义音色 URI。</div>
        </div>

        <label className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
          <span className="flex items-center justify-between text-[12px] text-ink-secondary">
            <span>语速</span><span className="font-mono text-ink">{speed.toFixed(2)}×</span>
          </span>
          <input type="range" min="0.25" max="4" step="0.05" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mt-2 w-full accent-accent" />
          <span className="mt-1 flex justify-between text-[10px] text-ink-secondary/70"><span>0.25×</span><span>正常</span><span>4.00×</span></span>
        </label>

        {provider === "siliconflow" && (
          <>
            <label className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
              <span className="flex items-center justify-between text-[12px] text-ink-secondary">
                <span>音量增益</span><span className="font-mono text-ink">{gain > 0 ? "+" : ""}{gain} dB</span>
              </span>
              <input type="range" min="-10" max="10" step="1" value={gain} onChange={(e) => setGain(Number(e.target.value))} className="mt-2 w-full accent-accent" />
              <span className="mt-1 flex justify-between text-[10px] text-ink-secondary/70"><span>更轻</span><span>原始</span><span>更响</span></span>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12px] text-ink-secondary">
              输出采样率
              <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} className="rounded-md border border-hairline/40 bg-card px-2 py-1 text-ink focus:outline-none">
                <option value={24_000}>24 kHz</option>
                <option value={32_000}>32 kHz</option>
                <option value={44_100}>44.1 kHz</option>
                <option value={48_000}>48 kHz</option>
              </select>
            </label>
          </>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={() => { setSpeed(1); setGain(0); setSampleRate(44_100); }} className="flex items-center gap-1 text-[11.5px] text-ink-secondary hover:text-ink">
            <RotateCcw size={12} /> 恢复声音默认值
          </button>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2">
          <span>
            <span className="block text-[13px] font-medium text-ink">自动朗读新回复</span>
            <span className="block text-[11px] text-ink-secondary">普通聊天中自动播放机器人最新回复</span>
          </span>
          <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} className="size-4 accent-accent" />
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={() => void save()} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saving ? "正在保存" : saved ? "已保存" : "保存语音设置"}
        </button>
        <button
          onClick={() => void preview()}
          disabled={saving || (!status?.tts.configured && !ttsUrl.trim())}
          className={cn("flex items-center justify-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40", speech.status !== "idle" && "text-accent")}
          title="保存当前参数并试听"
        >
          {speech.status === "preparing" || saving ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
          {speech.status === "idle" ? "试听" : "停止"}
        </button>
      </div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      {speech.error && <div className="mt-2 text-[12px] text-danger">{speech.error}</div>}
    </div>
  );
}
