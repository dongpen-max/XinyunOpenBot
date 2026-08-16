import { Loader2, Phone, PhoneOff, Square, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { VoiceBargeInDetector } from "@/lib/voice/barge-in";
import { VoiceRecorder, transcribeVoice } from "@/lib/voice/recorder";
import { useVoiceSpeech, voiceSpeaker } from "@/lib/voice/speaker";
import { SpeechTurnQueue } from "@/lib/voice/speech-queue";
import { StreamingSpeechBuffer } from "@/lib/voice/streaming-speech";
import { useStore, useStreaming, visibleMessages, type Bot } from "@/state/store";
import { MausAvatar } from "./Avatar";

export function SpeakButton({ botId, messageId, text }: { botId: string; messageId: string; text: string }) {
  const { state } = useStore();
  const speech = useVoiceSpeech();
  const active = speech.messageId === messageId && speech.status !== "idle";
  const configured = Boolean(state.config?.voice?.tts.configured);
  return (
    <button
      onClick={() => (active ? voiceSpeaker.stop() : void voiceSpeaker.speak(text, { botId, messageId }))}
      disabled={!configured || !text.trim()}
      aria-label={active ? "停止朗读" : "朗读消息"}
      title={configured ? (active ? "停止朗读" : "朗读消息") : "请先在应用设置中配置语音合成"}
      className={cn(
        "rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-20",
        active && "text-accent opacity-100",
      )}
    >
      {active && speech.status === "preparing" ? <Loader2 size={14} className="animate-spin" /> : active ? <Square size={13} className="fill-current" /> : <Volume2 size={14} />}
    </button>
  );
}

export function CallButton({ bot, active, onToggle }: { bot: Bot; active: boolean; onToggle: () => void }) {
  const { state, dispatch } = useStore();
  const ready = Boolean(state.config?.voice?.stt.configured && state.config?.voice?.tts.configured);
  return (
    <button
      onClick={() => {
        if (!active && !ready) {
          dispatch({ type: "toggleAppSettings", open: true });
          return;
        }
        onToggle();
      }}
      className={cn(
        "relative rounded-md p-1.5 hover:bg-raised",
        active ? "bg-danger/15 text-danger" : ready ? "text-ink-secondary hover:text-ink" : "text-ink-secondary/40",
      )}
      title={active ? "挂断语音通话" : ready ? `与 ${bot.name} 语音通话` : "请先配置 STT 和 TTS"}
      aria-label={active ? "挂断语音通话" : "开始语音通话"}
    >
      {active ? <PhoneOff size={18} /> : <Phone size={18} />}
      {!ready && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning" />}
    </button>
  );
}

type CallPhase = "listening" | "transcribing" | "thinking" | "speaking" | "error";
type QueuedSpeech = { text: string; botId: string; messageId: string };

export function CallOverlay({ bot, onHangup }: { bot: Bot; onHangup: () => void }) {
  const { state, dispatch } = useStore();
  const streaming = useStreaming().streaming[bot.threadId] ?? "";
  const speech = useVoiceSpeech();
  const [phase, setPhaseState] = useState<CallPhase>(bot.busy ? "thinking" : "listening");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const phaseRef = useRef<CallPhase>(phase);
  const listenRef = useRef<() => void>(() => {});
  const drainRef = useRef<() => void>(() => {});
  const settleTimerRef = useRef<number | null>(null);
  const streamIdleTimerRef = useRef<number | null>(null);
  const seenMessageIds = useRef(new Set(visibleMessages(bot).map((message) => message.id)));
  const queue = useRef(new SpeechTurnQueue<QueuedSpeech>());
  const draining = useRef(false);
  const drainRun = useRef(0);
  const bargeIn = useRef(new VoiceBargeInDetector());
  const interruptRef = useRef<() => void>(() => {});
  const busyRef = useRef(Boolean(bot.busy));
  const streamBuffer = useRef(new StreamingSpeechBuffer());
  const streamActive = useRef(false);
  const streamText = useRef("");
  const streamEpoch = useRef(0);
  const streamSequence = useRef(0);
  const streamQueueEpoch = useRef(queue.current.epoch);
  const suppressCurrentStream = useRef(false);

  busyRef.current = Boolean(bot.busy);

  const setPhase = useCallback((next: CallPhase) => {
    phaseRef.current = next;
    if (alive.current) setPhaseState(next);
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  const clearStreamIdleTimer = useCallback(() => {
    if (streamIdleTimerRef.current !== null) window.clearTimeout(streamIdleTimerRef.current);
    streamIdleTimerRef.current = null;
  }, []);

  const listen = useCallback(async () => {
    if (!alive.current) return;
    const mine = generation.current;
    clearSettleTimer();
    voiceSpeaker.stop();
    recorderRef.current?.cancel();
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    setHeard("");
    setError(null);
    setPhase("listening");
    try {
      await recorder.start({
        endpointMs: 1100,
        noSpeechTimeoutMs: 15_000,
        maxDurationMs: 90_000,
        deviceId: state.config?.voice?.input.deviceId,
      });
      const recording = await recorder.waitForStop();
      if (!alive.current || mine !== generation.current || recorderRef.current !== recorder) return;
      recorderRef.current = null;
      if (!recording?.heardSound || recording.blob.size < 256) {
        window.setTimeout(() => listenRef.current(), 200);
        return;
      }
      setPhase("transcribing");
      const transcript = await transcribeVoice(recording);
      if (!alive.current || mine !== generation.current) return;
      setHeard(transcript);
      setPhase("thinking");
      queue.current.invalidate();
      clearStreamIdleTimer();
      streamActive.current = false;
      streamText.current = "";
      streamBuffer.current.reset();
      suppressCurrentStream.current = false;
      dispatch({ type: "send", botId: bot.id, text: transcript });
    } catch (e) {
      if (!alive.current || mine !== generation.current) return;
      recorderRef.current = null;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [bot.id, clearSettleTimer, clearStreamIdleTimer, dispatch, setPhase, state.config?.voice?.input.deviceId]);
  listenRef.current = () => void listen();

  const scheduleListening = useCallback(() => {
    clearSettleTimer();
    if (!alive.current || busyRef.current || draining.current || queue.current.length > 0) return;
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      if (
        alive.current &&
        !busyRef.current &&
        !draining.current &&
        queue.current.length === 0 &&
        phaseRef.current !== "error"
      ) {
        listenRef.current();
      }
    }, 650);
  }, [clearSettleTimer]);

  const drainQueue = useCallback(() => {
    if (!alive.current || draining.current || queue.current.length === 0) return;
    const run = ++drainRun.current;
    draining.current = true;
    clearSettleTimer();

    void (async () => {
      try {
        while (alive.current && run === drainRun.current && queue.current.length > 0) {
          const reply = queue.current.shift();
          if (!reply) break;
          recorderRef.current?.cancel();
          recorderRef.current = null;
          setError(null);
          setPhase("speaking");
          const played = await voiceSpeaker.speak(reply.text, {
            botId: reply.botId,
            messageId: reply.messageId,
            onPlaybackStart: () => void bargeIn.current.start(() => interruptRef.current(), state.config?.voice?.input),
            onPlaybackEnd: () => bargeIn.current.stop(),
          });
          if (!alive.current || run !== drainRun.current) return;
          if (!played) {
            queue.current.invalidate();
            setError(voiceSpeaker.state.error ?? "语音播放已中断，请重试");
            setPhase("error");
            return;
          }
        }
      } finally {
        if (run !== drainRun.current) return;
        draining.current = false;
        if (queue.current.length > 0) drainRef.current();
        else if (phaseRef.current !== "error") {
          if (busyRef.current) setPhase("thinking");
          else scheduleListening();
        }
      }
    })();
  }, [clearSettleTimer, scheduleListening, setPhase, state.config?.voice?.input]);
  drainRef.current = drainQueue;

  const enqueue = useCallback((items: QueuedSpeech[], epoch = queue.current.epoch) => {
    const speakable = items.filter((item) => item.text.trim());
    if (speakable.length === 0) return;
    if (!queue.current.enqueue(speakable, epoch)) return;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    drainRef.current();
  }, []);

  const streamItems = useCallback((chunks: string[], messageId?: string): QueuedSpeech[] =>
    chunks.map((text) => ({
      text,
      botId: bot.id,
      messageId: messageId
        ? `${messageId}:voice:${streamSequence.current++}`
        : `stream:${bot.threadId}:${streamEpoch.current}:${streamSequence.current++}`,
    })), [bot.id, bot.threadId]);

  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => {
      if (!bot.busy) listenRef.current();
      else setPhase("thinking");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      clearSettleTimer();
      clearStreamIdleTimer();
      alive.current = false;
      generation.current += 1;
      drainRun.current += 1;
      queue.current.invalidate();
      bargeIn.current.stop();
      recorderRef.current?.cancel();
      recorderRef.current = null;
      voiceSpeaker.stop();
    };
    // This component is mounted for one bot/call session only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages = visibleMessages(bot);
  useEffect(() => {
    clearStreamIdleTimer();
    if (!streaming || suppressCurrentStream.current) return;
    if (!streamActive.current) {
      streamActive.current = true;
      streamBuffer.current.reset();
      streamEpoch.current += 1;
      streamSequence.current = 0;
      streamQueueEpoch.current = queue.current.epoch;
    }
    streamText.current = streaming;
    enqueue(streamItems(streamBuffer.current.update(streaming)), streamQueueEpoch.current);
    streamIdleTimerRef.current = window.setTimeout(() => {
      streamIdleTimerRef.current = null;
      if (!alive.current || !streamActive.current) return;
      enqueue(streamItems(streamBuffer.current.update(streamText.current, { idle: true })), streamQueueEpoch.current);
    }, 500);
    return clearStreamIdleTimer;
  }, [clearStreamIdleTimer, enqueue, streamItems, streaming]);

  useEffect(() => {
    const replies: QueuedSpeech[] = [];
    let repliesEpoch = queue.current.epoch;
    for (const message of messages) {
      if (seenMessageIds.current.has(message.id)) continue;
      seenMessageIds.current.add(message.id);
      const text = message.text?.trim();
      if (message.role !== "bot" || message.kind !== "text" || !text) continue;

      if (suppressCurrentStream.current) {
        clearStreamIdleTimer();
        suppressCurrentStream.current = false;
        streamActive.current = false;
        streamText.current = "";
        streamBuffer.current.reset();
        continue;
      }

      if (streamActive.current) {
        repliesEpoch = streamQueueEpoch.current;
        clearStreamIdleTimer();
        replies.push(...streamItems(streamBuffer.current.update(text, { final: true }), message.id));
        streamActive.current = false;
        streamText.current = "";
      } else {
        replies.push({ text, botId: bot.id, messageId: message.id });
      }
    }
    enqueue(replies, repliesEpoch);
  }, [bot.id, clearStreamIdleTimer, enqueue, messages, streamItems]);

  useEffect(() => {
    busyRef.current = Boolean(bot.busy);
    if (bot.busy) {
      clearSettleTimer();
      if (!draining.current && queue.current.length === 0 && phaseRef.current !== "transcribing") {
        setPhase("thinking");
      }
      return;
    }
    if (!draining.current && queue.current.length === 0 && phaseRef.current === "thinking") scheduleListening();
  }, [bot.busy, clearSettleTimer, scheduleListening, setPhase]);

  const interruptSpeech = useCallback(() => {
    if (phaseRef.current !== "speaking") return;
    drainRun.current += 1;
    draining.current = false;
    queue.current.invalidate();
    clearStreamIdleTimer();
    suppressCurrentStream.current = streamActive.current;
    streamActive.current = false;
    streamText.current = "";
    streamBuffer.current.reset();
    bargeIn.current.stop();
    voiceSpeaker.stop();
    setError(null);
    listenRef.current();
  }, [clearStreamIdleTimer]);
  interruptRef.current = interruptSpeech;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onHangup();
      } else if (event.code === "Space" && phaseRef.current === "speaking") {
        event.preventDefault();
        interruptSpeech();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interruptSpeech, onHangup]);

  const stopTurn = () => {
    if (phaseRef.current === "listening") void recorderRef.current?.stop();
  };
  const status =
    phase === "listening"
      ? "正在聆听"
      : phase === "transcribing"
        ? "正在识别"
        : phase === "thinking"
          ? `${bot.name} 正在思考`
          : phase === "speaking"
            ? `${bot.name} 正在说话`
            : "通话遇到问题";
  const avatarState = phase === "listening" ? "listening" : phase === "speaking" ? "sending" : "working";

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-app/95 backdrop-blur-sm">
      <button onClick={onHangup} className="absolute right-5 top-5 rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="挂断">
        <X size={18} />
      </button>
      <MausAvatar color={bot.color} shape={bot.mascotShape} state={avatarState} size={220} animated trackPointer />
      <div className="text-center">
        <div className="text-[20px] font-medium text-ink">{bot.name}</div>
        <div className="mt-1 flex items-center justify-center gap-2 text-[13.5px] text-ink-secondary">
          {(phase === "transcribing" || phase === "thinking") && <Loader2 size={13} className="animate-spin" />}
          {status}
        </div>
      </div>
      <div className="min-h-[3.5rem] max-w-[560px] px-6 text-center text-[15px] leading-relaxed text-ink">
        {phase === "speaking" ? speech.caption : heard || (phase === "listening" ? <span className="text-ink-secondary">请开始说话，停顿后自动发送…</span> : null)}
      </div>
      {error && <div className="max-w-[460px] text-center text-[12.5px] text-danger">{error}</div>}
      {speech.error && <div className="max-w-[460px] text-center text-[12.5px] text-danger">{speech.error}</div>}
      <div className="flex items-center gap-3">
        {phase === "listening" && (
          <button onClick={stopTurn} className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised">说完了</button>
        )}
        {phase === "error" && (
          <button onClick={() => listenRef.current()} className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised">重试麦克风</button>
        )}
        {phase === "speaking" && (
          <button onClick={interruptSpeech} className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised">打断</button>
        )}
        <button onClick={onHangup} className="flex items-center gap-2 rounded-full bg-danger px-5 py-2.5 text-[14px] font-medium text-white hover:brightness-110">
          <PhoneOff size={16} /> 挂断
        </button>
      </div>
      <div className="text-[11.5px] text-ink-secondary/70">回复生成时按句播放 · 直接说话或空格打断 · Esc 挂断</div>
    </div>
  );
}
