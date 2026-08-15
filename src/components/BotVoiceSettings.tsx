import { ChevronDown, RotateCcw, Volume2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { voiceOptions } from "@/lib/voice/options";
import { useVoiceSpeech, voiceSpeaker } from "@/lib/voice/speaker";
import { useStore, type Bot } from "@/state/store";

const SAMPLE = "你好，这是我的专属声音。群聊和单独聊天都会使用这套音色。";
const inputClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

export function BotVoiceSettings({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const speech = useVoiceSpeech();
  const [open, setOpen] = useState(false);
  const defaults = state.config?.voice?.tts;
  const custom = bot.voiceProfile ?? null;
  const provider = defaults?.provider ?? "openai";
  const effective = {
    voice: custom?.voice || defaults?.voice || "alloy",
    speed: custom?.speed ?? defaults?.speed ?? 1,
    gain: custom?.gain ?? defaults?.gain ?? 0,
  };
  const patch = (next: typeof effective | null) => {
    dispatch({ type: "updateBot", botId: bot.id, patch: { voiceProfile: next } });
  };
  const update = (next: Partial<typeof effective>) => patch({ ...effective, ...next });
  const active = speech.botId === bot.id && speech.status !== "idle";
  const options = voiceOptions(provider);
  const listId = `bot-voice-options-${bot.id}`;

  return (
    <section className="overflow-hidden rounded-xl border border-hairline/40 bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-border"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Volume2 size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-ink">专属声音</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-[10.5px] text-ink-secondary">
              {custom ? `${effective.speed.toFixed(2)}×` : "跟随应用默认"}
            </span>
          </span>
          <span className="mt-0.5 block text-[11.5px] text-ink-secondary">单聊与群聊朗读时按机器人区分音色和语速</span>
        </span>
        <ChevronDown size={15} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-hairline/30 p-4">
          {!defaults?.configured && (
            <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              请先在应用设置中配置 TTS 服务，再试听专属声音。
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-[12px] text-ink-secondary">音色</span>
            <input
              list={listId}
              value={effective.voice}
              onChange={(event) => update({ voice: event.target.value })}
              className={inputClass}
              placeholder="选择或填写音色 URI"
              aria-label={`${bot.name} 的音色`}
            />
            <datalist id={listId}>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
          </label>

          <label className="mt-3 block rounded-lg border border-hairline/40 bg-inset px-3 py-2">
            <span className="flex items-center justify-between text-[12px] text-ink-secondary">
              <span>语速</span><span className="font-mono text-ink">{effective.speed.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min="0.25"
              max="4"
              step="0.05"
              value={effective.speed}
              onChange={(event) => update({ speed: Number(event.target.value) })}
              className="mt-2 w-full accent-accent"
            />
          </label>

          {provider === "siliconflow" && (
            <label className="mt-3 block rounded-lg border border-hairline/40 bg-inset px-3 py-2">
              <span className="flex items-center justify-between text-[12px] text-ink-secondary">
                <span>音量增益</span><span className="font-mono text-ink">{effective.gain > 0 ? "+" : ""}{effective.gain} dB</span>
              </span>
              <input
                type="range"
                min="-10"
                max="10"
                step="1"
                value={effective.gain}
                onChange={(event) => update({ gain: Number(event.target.value) })}
                className="mt-2 w-full accent-accent"
              />
            </label>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => patch(null)}
              disabled={!custom}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-35"
            >
              <RotateCcw size={13} /> 跟随应用默认
            </button>
            <button
              type="button"
              onClick={() => (active ? voiceSpeaker.stop() : void voiceSpeaker.speak(SAMPLE, { botId: bot.id, tuning: effective }))}
              disabled={!defaults?.configured}
              className={cn("flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-40", active && "text-accent")}
            >
              <Volume2 size={13} /> {active ? "停止" : "试听"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
