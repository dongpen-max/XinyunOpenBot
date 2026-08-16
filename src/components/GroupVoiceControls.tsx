import { Loader2, Phone, PhoneOff, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { type GroupCallReply } from "@/lib/voice/group-call";
import { VoiceBargeInDetector } from "@/lib/voice/barge-in";
import { VoiceRecorder, transcribeVoice } from "@/lib/voice/recorder";
import { useVoiceSpeech, voiceSpeaker } from "@/lib/voice/speaker";
import { SpeechTurnQueue } from "@/lib/voice/speech-queue";
import { StreamingSpeechBuffer } from "@/lib/voice/streaming-speech";
import { useStore, useStreaming, type Bot, type Group } from "@/state/store";
import { MausAvatar } from "./Avatar";

export function GroupCallButton({
  group,
  active,
  onToggle,
}: {
  group: Group;
  active: boolean;
  onToggle: () => void;
}) {
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
        "relative rounded-md p-1.5 transition-colors hover:bg-raised",
        active ? "bg-danger/15 text-danger" : ready ? "text-ink-secondary hover:text-ink" : "text-ink-secondary/40",
      )}
      title={active ? "挂断群聊语音通话" : ready ? `进入 ${group.name} 的语音通话` : "请先配置 STT 和 TTS"}
      aria-label={active ? "挂断群聊语音通话" : "开始群聊语音通话"}
    >
      {active ? <PhoneOff size={18} /> : <Phone size={18} />}
      {!ready && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning" />}
    </button>
  );
}

type GroupCallPhase = "listening" | "transcribing" | "thinking" | "speaking" | "error";

export function GroupCallOverlay({
  group,
  members,
  onHangup,
}: {
  group: Group;
  members: Bot[];
  onHangup: () => void;
}) {
  const { state, dispatch } = useStore();
  const streaming = useStreaming().streaming[group.threadId] ?? "";
  const speech = useVoiceSpeech();
  const [phase, setPhaseState] = useState<GroupCallPhase>(group.busyBotId ? "thinking" : "listening");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [speakingBotId, setSpeakingBotId] = useState<string | null>(null);

  const alive = useRef(true);
  const generation = useRef(0);
  const phaseRef = useRef<GroupCallPhase>(phase);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const listenRef = useRef<() => void>(() => {});
  const drainRef = useRef<() => void>(() => {});
  const settleTimerRef = useRef<number | null>(null);
  const streamIdleTimerRef = useRef<number | null>(null);
  const seenMessageIds = useRef(new Set(group.messages.map((message) => message.id)));
  const queue = useRef(new SpeechTurnQueue<GroupCallReply>());
  const draining = useRef(false);
  const drainRun = useRef(0);
  const bargeIn = useRef(new VoiceBargeInDetector());
  const interruptRef = useRef<() => void>(() => {});
  const busyRef = useRef(Boolean(group.busyBotId));
  const membersRef = useRef(members);
  const lastBusyBotId = useRef<string | null>(group.busyBotId ?? null);
  const streamBuffer = useRef(new StreamingSpeechBuffer());
  const streamActive = useRef(false);
  const streamBotId = useRef<string | null>(null);
  const streamText = useRef("");
  const streamEpoch = useRef(0);
  const streamSequence = useRef(0);
  const streamQueueEpoch = useRef(queue.current.epoch);
  const suppressCurrentStream = useRef(false);

  membersRef.current = members;
  busyRef.current = Boolean(group.busyBotId);
  if (group.busyBotId) lastBusyBotId.current = group.busyBotId;

  const setPhase = useCallback((next: GroupCallPhase) => {
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
    setSpeakingBotId(null);
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
      streamBotId.current = null;
      streamText.current = "";
      streamBuffer.current.reset();
      suppressCurrentStream.current = false;
      dispatch({ type: "sendGroup", groupId: group.id, text: transcript });
    } catch (cause) {
      if (!alive.current || mine !== generation.current) return;
      recorderRef.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }, [clearSettleTimer, clearStreamIdleTimer, dispatch, group.id, setPhase, state.config?.voice?.input.deviceId]);
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
    }, 700);
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
          setSpeakingBotId(reply.botId);
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
            setSpeakingBotId(null);
            setError(voiceSpeaker.state.error ?? "语音播放已中断，请重试");
            setPhase("error");
            return;
          }
        }
      } finally {
        if (run !== drainRun.current) return;
        draining.current = false;
        setSpeakingBotId(null);
        if (queue.current.length > 0) drainRef.current();
        else if (phaseRef.current !== "error") {
          if (busyRef.current) setPhase("thinking");
          else scheduleListening();
        }
      }
    })();
  }, [clearSettleTimer, scheduleListening, setPhase, state.config?.voice?.input]);
  drainRef.current = drainQueue;

  const enqueue = useCallback((items: GroupCallReply[], epoch = queue.current.epoch) => {
    const speakable = items.filter((item) => item.text.trim());
    if (!queue.current.enqueue(speakable, epoch)) return;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    drainRef.current();
  }, []);

  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => {
      if (busyRef.current) setPhase("thinking");
      else listenRef.current();
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
      streamActive.current = false;
      streamBuffer.current.reset();
      recorderRef.current?.cancel();
      recorderRef.current = null;
      voiceSpeaker.stop();
    };
    // This component is mounted for one room/call session only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const replies: GroupCallReply[] = [];
    let repliesEpoch = queue.current.epoch;
    for (const message of group.messages) {
      if (seenMessageIds.current.has(message.id)) continue;
      seenMessageIds.current.add(message.id);
      const text = message.text?.trim();
      const botId = message.from?.botId;
      if (message.role !== "bot" || message.kind !== "text" || !text || !botId) continue;

      if (suppressCurrentStream.current) {
        clearStreamIdleTimer();
        suppressCurrentStream.current = false;
        streamActive.current = false;
        streamBotId.current = null;
        streamText.current = "";
        streamBuffer.current.reset();
        continue;
      }

      if (streamActive.current) {
        repliesEpoch = streamQueueEpoch.current;
        clearStreamIdleTimer();
        for (const chunk of streamBuffer.current.update(text, { final: true })) {
          replies.push({
            text: chunk,
            botId,
            messageId: `${message.id}:voice:${streamSequence.current++}`,
          });
        }
        streamActive.current = false;
        streamBotId.current = null;
        streamText.current = "";
      } else {
        replies.push({ text, botId, messageId: message.id });
      }
    }
    if (replies.length === 0) return;
    enqueue(replies, repliesEpoch);
  }, [clearStreamIdleTimer, enqueue, group.messages]);

  useEffect(() => {
    clearStreamIdleTimer();
    if (!streaming || suppressCurrentStream.current) return;
    if (!streamActive.current) {
      streamActive.current = true;
      streamBotId.current = group.busyBotId ?? lastBusyBotId.current;
      streamBuffer.current.reset();
      streamEpoch.current += 1;
      streamSequence.current = 0;
      streamQueueEpoch.current = queue.current.epoch;
    } else if (!streamBotId.current && group.busyBotId) {
      streamBotId.current = group.busyBotId;
    }

    streamText.current = streaming;
    const botId = streamBotId.current;
    if (botId) {
      const replies = streamBuffer.current.update(streaming).map((text) => ({
        text,
        botId,
        messageId: `stream:${group.threadId}:${streamEpoch.current}:${streamSequence.current++}`,
      }));
      if (replies.length > 0) {
        enqueue(replies, streamQueueEpoch.current);
      }
    }

    streamIdleTimerRef.current = window.setTimeout(() => {
      streamIdleTimerRef.current = null;
      const idleBotId = streamBotId.current;
      if (!alive.current || !streamActive.current || !idleBotId || suppressCurrentStream.current) return;
      const replies = streamBuffer.current.update(streamText.current, { idle: true }).map((text) => ({
        text,
        botId: idleBotId,
        messageId: `stream:${group.threadId}:${streamEpoch.current}:${streamSequence.current++}`,
      }));
      if (replies.length > 0) {
        enqueue(replies, streamQueueEpoch.current);
      }
    }, 500);
    return clearStreamIdleTimer;
  }, [clearStreamIdleTimer, enqueue, group.busyBotId, group.threadId, streaming]);

  useEffect(() => {
    busyRef.current = Boolean(group.busyBotId);
    if (group.busyBotId) {
      clearSettleTimer();
      if (!draining.current && queue.current.length === 0 && phaseRef.current !== "transcribing") {
        setPhase("thinking");
      }
      return;
    }
    if (!draining.current && queue.current.length === 0 && phaseRef.current === "thinking") scheduleListening();
  }, [clearSettleTimer, group.busyBotId, scheduleListening, setPhase]);

  const interruptSpeech = useCallback(() => {
    if (phaseRef.current !== "speaking") return;
    drainRun.current += 1;
    draining.current = false;
    queue.current.invalidate();
    clearStreamIdleTimer();
    suppressCurrentStream.current = streamActive.current;
    streamActive.current = false;
    streamBotId.current = null;
    streamText.current = "";
    streamBuffer.current.reset();
    bargeIn.current.stop();
    voiceSpeaker.stop();
    setSpeakingBotId(null);
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
  const speakingBot = members.find((member) => member.id === speakingBotId);
  const thinkingBot = members.find((member) => member.id === group.busyBotId);
  const isWin = window.ogb?.platform === "win32";
  const status =
    phase === "listening"
      ? "正在聆听"
      : phase === "transcribing"
        ? "正在识别"
        : phase === "thinking"
          ? `${thinkingBot?.name ?? "群成员"} 正在思考`
          : phase === "speaking"
            ? `${speakingBot?.name ?? "群成员"} 正在说话`
            : "通话遇到问题";

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-app/95 px-6 backdrop-blur-sm">
      <button
        onClick={onHangup}
        className={cn(
          "absolute top-5 rounded-md p-2 text-ink-secondary transition-colors hover:bg-raised hover:text-ink",
          isWin ? "right-[148px]" : "right-5",
        )}
        aria-label="挂断"
      >
        <X size={18} />
      </button>

      <div className="flex max-w-[680px] flex-wrap items-center justify-center gap-4" aria-label="群聊成员">
        {members.map((member) => {
          const speaking = member.id === speakingBotId;
          const thinking = phase === "thinking" && member.id === group.busyBotId;
          const avatarState = speaking ? "sending" : thinking ? "working" : phase === "listening" ? "listening" : "happy";
          return (
            <div key={member.id} className="flex min-w-20 flex-col items-center gap-2">
              <span
                className={cn(
                  "relative inline-flex rounded-full transition-shadow duration-200",
                  speaking && "ring-2 ring-accent ring-offset-4 ring-offset-app",
                  thinking && "ring-2 ring-accent/40 ring-offset-4 ring-offset-app",
                )}
              >
                <MausAvatar
                  color={member.color}
                  shape={member.mascotShape}
                  state={avatarState}
                  size={76}
                  animated={speaking || thinking || phase === "listening"}
                />
                {(speaking || thinking) && (
                  <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-app bg-accent" />
                )}
              </span>
              <span className={cn("max-w-24 truncate text-[12.5px] text-ink-secondary", speaking && "font-medium text-ink")}>{member.name}</span>
            </div>
          );
        })}
      </div>

      <div className="text-center">
        <div className="text-[20px] font-medium text-ink">{group.name}</div>
        <div className="mt-1 flex items-center justify-center gap-2 text-[13.5px] text-ink-secondary">
          {(phase === "transcribing" || phase === "thinking") && <Loader2 size={13} className="animate-spin" />}
          {status}
        </div>
      </div>

      <div className="min-h-[3.5rem] max-w-[620px] text-center text-[15px] leading-relaxed text-ink">
        {phase === "speaking"
          ? speech.caption
          : heard || (phase === "listening" ? <span className="text-ink-secondary">请开始说话，停顿后自动发送到群聊…</span> : null)}
      </div>

      {error && <div className="max-w-[500px] text-center text-[12.5px] text-danger">{error}</div>}
      {!error && speech.error && <div className="max-w-[500px] text-center text-[12.5px] text-danger">{speech.error}</div>}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {phase === "listening" && (
          <button onClick={stopTurn} className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised">
            说完了
          </button>
        )}
        {phase === "error" && (
          <button onClick={() => listenRef.current()} className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised">
            重试麦克风
          </button>
        )}
        {phase === "speaking" && (
          <button onClick={interruptSpeech} className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised">
            打断
          </button>
        )}
        {group.busyBotId && (
          <button
            onClick={() => dispatch({ type: "interruptGroup", groupId: group.id })}
            className="flex items-center gap-2 rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised"
          >
            <Square size={13} className="fill-current" /> 停止任务
          </button>
        )}
        <button onClick={onHangup} className="flex items-center gap-2 rounded-full bg-danger px-5 py-2.5 text-[14px] font-medium text-white hover:brightness-110">
          <PhoneOff size={16} /> 挂断
        </button>
      </div>

      <div className="text-center text-[11.5px] text-ink-secondary/70">机器人边生成边按顺序发言 · 直接说话或空格打断 · Esc 挂断</div>
    </div>
  );
}
