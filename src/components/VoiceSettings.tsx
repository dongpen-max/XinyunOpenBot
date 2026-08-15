import { Check, Loader2, Mic, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { voiceSpeaker, useVoiceSpeech } from "@/lib/voice/speaker";

const SAMPLE = "你好，我是星云机器人。语音聊天已经准备好了。";
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
    setAutoSpeak(status.autoSpeak);
  }, [status]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const stt: Record<string, string> = {
        url: sttUrl.trim(),
        model: sttModel.trim(),
        language: language.trim(),
      };
      const tts: Record<string, string> = {
        url: ttsUrl.trim(),
        model: ttsModel.trim(),
        voice: voice.trim(),
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Mic size={18} />
        </span>
        <div>
          <div className="text-[15px] font-medium text-ink">语音聊天</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
            使用兼容 OpenAI Audio API 的语音识别和语音合成服务。密钥只保存在本机配置中。
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
        <div className="mt-1 text-[13px] font-medium text-ink">语音合成（TTS）</div>
        <input className={inputClass} value={ttsUrl} onChange={(e) => setTtsUrl(e.target.value)} placeholder="https://api.example.com/v1" aria-label="TTS URL" />
        <input className={inputClass} type="password" value={ttsKey} onChange={(e) => setTtsKey(e.target.value)} autoComplete="off" placeholder={status?.tts.keyConfigured ? "••••••••（留空保持原密钥）" : "TTS API Key（本地服务可留空）"} aria-label="TTS API Key" />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} placeholder="tts-1" aria-label="TTS 模型" />
          <input className={inputClass} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="alloy" aria-label="TTS 声音" />
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
          onClick={() => (voiceSpeaker.isSpeaking() ? voiceSpeaker.stop() : void voiceSpeaker.speak(SAMPLE))}
          disabled={!status?.tts.configured && !ttsUrl.trim()}
          className={cn("flex items-center justify-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40", speech.status !== "idle" && "text-accent")}
          title="试听当前已保存的 TTS 配置"
        >
          {speech.status === "preparing" ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
          {speech.status === "idle" ? "试听" : "停止"}
        </button>
      </div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      {speech.error && <div className="mt-2 text-[12px] text-danger">{speech.error}</div>}
    </div>
  );
}
