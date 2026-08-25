import { Component, memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  ListTree,
  Loader2,
  Monitor,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Square,
  X,
} from "lucide-react";
import { useStore, useStreaming, formatTime, messageVersions, visibleMessages, type Bot, type Message } from "@/state/store";
import { MausAvatar } from "./Avatar";
import { stateForBot } from "@/lib/mascot";
import { ChatMarkdown } from "./ChatMarkdown";
import { OptionCard } from "./OptionCard";
import { ApprovalCard } from "./ApprovalCard";
import { Composer } from "./Composer";
import { ModelPicker } from "./ModelPicker";
import { TaskPicker } from "./TaskPicker";
import { ReactionBar, ReactionChips } from "./Reactions";
import { cn } from "@/lib/cn";
import { actionableRuntimeError, deriveWorkStatus } from "@/lib/work-status";
import { zhCN } from "@/locales/zh-CN";
import { CallButton, CallOverlay, SpeakButton } from "./VoiceControls";
import { voiceSpeaker } from "@/lib/voice/speaker";
import { expandWindowStart, resolveTranscriptWindow, tailWindowStart } from "@/lib/transcript-window";
import { attachmentBasename, splitAttachedImages } from "@/lib/composer-attachments";
import { timelineEvents } from "@/lib/taskTimeline";
import { ReplyQuote } from "./ReplyPreview";
import type { ReplyReference } from "@/state/store";

/** Long user messages collapse behind a fade so pasted walls of text don't
 * bury the conversation; bots get full markdown. */
const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;

function TaskTimeline({ messages, busy, onJump }: { messages: Message[]; busy: boolean; onJump: (messageId: string) => void }) {
  const [open, setOpen] = useState(false);
  const events = useMemo(() => timelineEvents(messages), [messages]);
  if (events.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-[900px] px-5 pt-1">
      <button onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-raised/50 hover:text-ink">
        <span className="flex items-center gap-1.5"><ListTree size={14} /> 执行时间线{busy ? " · 执行中" : ""}</span>
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && <ol className="ml-2 max-h-56 overflow-y-auto border-l border-hairline/40 pb-2 pl-3">
        {events.slice(-24).map((event) => <li key={event.id} className="relative py-0.5">
          <span className={cn("absolute -left-[17px] size-2 rounded-full", event.state === "failed" ? "bg-danger" : event.state === "complete" ? "bg-success" : "bg-ink-secondary")} />
          <button type="button" onClick={() => onJump(event.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-ink-secondary hover:bg-raised/60 hover:text-ink">
            <span className="min-w-0 flex-1 truncate">{event.label}</span>
            <time className="shrink-0 text-[11px] text-ink-secondary/70">{formatTime(event.at)}</time>
          </button>
        </li>)}
      </ol>}
    </div>
  );
}

function HandoffStrip({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const items = Object.values(state.handoffs)
    .filter((handoff) => handoff.fromBotId === bot.id || handoff.toBotId === bot.id)
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
    .slice(0, 4);
  if (!items.length) return null;
  const nameOf = (id: string) => state.bots.find((candidate) => candidate.id === id)?.name ?? "机器人";
  const statusLabel = (status: (typeof items)[number]["status"]) =>
    status === "queued" ? "等待接手" : status === "running" ? "执行中" : status === "completed" ? "已完成" : "失败";
  return (
    <div className="mx-auto w-full max-w-[900px] px-5 pt-1">
      <div className="rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-accent">
          <ArrowRight size={13} /> 协作交接
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((handoff) => (
            <span key={handoff.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline/35 bg-panel/70 px-2 py-1 text-[11.5px] text-ink-secondary">
              <span className="max-w-[110px] truncate text-ink">{nameOf(handoff.fromBotId)}</span>
              <ArrowRight size={11} className="shrink-0" />
              <span className="max-w-[110px] truncate text-ink">{nameOf(handoff.toBotId)}</span>
              <span className={cn("shrink-0", handoff.status === "failed" ? "text-danger" : handoff.status === "completed" ? "text-success" : "text-accent")}>
                {statusLabel(handoff.status)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Today" / "Yesterday" / "Mon, Aug 11" — real dates, not a hardcoded label. */
function dayLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  return d.toLocaleDateString("zh-CN", { weekday: "short", month: "short", day: "numeric" });
}

function DaySeparator({ at }: { at: number }) {
  return (
    <div className="py-3 text-center text-[13px] text-ink-secondary">
      {dayLabel(at)} {formatTime(at)}
    </div>
  );
}

/** Hover/focus-revealed copy control shared by user + bot bubbles. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label="复制消息"
      title="复制消息"
      className={cn(
        "rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
        className,
      )}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  );
}

/** Live extended thinking: shimmer label + collapsible reasoning text.
 * Ephemeral — rendered only while the turn runs, dropped when it settles. */
function ThinkingStrip({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [text, open]);
  return (
    <div className="flex w-full justify-start">
      <div className="assistant-message-width min-w-[200px]">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] hover:bg-raised/40"
        >
          <Brain size={13} className="text-ink-secondary" />
          <span className={cn(active ? "thinking-shimmer animate-shimmer" : "text-ink-secondary")}>
            {active ? "正在分析…" : "分析过程"}
          </span>
          <ChevronDown size={12} className={cn("text-ink-secondary transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <div
            ref={tailRef}
            className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-hairline/30 bg-panel px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-secondary"
          >
            {text}
          </div>
        ) : (
          active && (
            <div className="mt-0.5 truncate pl-6 text-[12px] text-ink-secondary/70">
              {text.slice(-120).split("\n").pop()}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** A failed turn: a real error block with a retry, not a truncated pill. */
function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const error = actionableRuntimeError(message);
  return (
    <div className="flex justify-start">
      <div className="assistant-message-width rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13.5px] text-danger">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            <span className="block font-medium">{error.summary}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-danger/85">{error.hint}</span>
            {error.technical && error.technical !== error.summary && (
              <code className="mt-1.5 block max-w-full overflow-x-auto rounded bg-danger/10 px-2 py-1 font-mono text-[10.5px] text-danger/80">{error.technical}</code>
            )}
          </span>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-1.5 flex items-center gap-1.5 rounded-full border border-danger/30 px-2.5 py-1 text-[12.5px] hover:bg-danger/15"
          >
            <RefreshCw size={12} /> 重试
          </button>
        )}
      </div>
    </div>
  );
}

/** One bad markdown node must not white-screen the app — the transcript
 * degrades to a plain-text bubble instead. */
class MessageBoundary extends Component<{ children: ReactNode; fallbackText: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="assistant-message-surface assistant-message-width rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink">
          {this.props.fallbackText}
        </div>
      );
    }
    return this.props.children;
  }
}

/** Inline editor a user bubble turns into: Enter sends (forking the
 * conversation), Esc cancels. Shift+Enter for a newline, like everywhere. */
function BubbleEditor({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const submit = () => {
    if (draft.trim()) onSubmit(draft.trim());
  };
  return (
    <div className="user-message-width w-full rounded-2xl border border-hairline/40 bg-bubble-user px-4 py-3">
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // isComposing: an IME confirm-Enter must not submit the edit
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={Math.min(10, Math.max(2, draft.split("\n").length))}
        className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-white disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}

function Bubble({
  bot,
  message,
  editing,
  isLastBotText,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onReply,
}: {
  bot: Bot;
  message: Message;
  editing: boolean;
  isLastBotText: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (text: string) => void;
  onRegenerate?: () => void;
  onReply: (message: Message) => void;
}) {
  const { dispatch } = useStore();
  const user = message.role === "user";
  const [expanded, setExpanded] = useState(false);
  const text = message.text ?? "";
  const attachedImages = user && message.kind === "text" ? splitAttachedImages(text) : null;
  const visibleText = attachedImages?.display ?? text;
  const collapsible =
    user && !expanded && (visibleText.length > USER_COLLAPSE_CHARS || visibleText.split("\n").length > USER_COLLAPSE_LINES);

  if (user && editing) {
    return (
      <div className="flex w-full justify-end">
        <BubbleEditor initial={text} onCancel={onCancelEdit} onSubmit={onSubmitEdit} />
      </div>
    );
  }

  // "‹ 2/3 ›" under an edited message — every fork it belongs to
  const versions = user ? messageVersions(bot, message) : [message];
  const versionIndex = versions.findIndex((v) => v.id === message.id);
  const switchTo = (v: Message | undefined) => {
    if (v && !bot.busy) dispatch({ type: "switchBranch", botId: bot.id, messageId: v.id });
  };

  return (
    <div className={cn("group animate-msg-in flex w-full flex-col", user ? "items-end" : "items-start")}>
      <div className={cn("flex w-full items-center gap-1.5", user ? "justify-end" : "flex-wrap justify-start")}>
        {/* editing rewinds the thread, so it waits for the turn to end —
            same rule as the version switcher below */}
        {user && message.kind === "text" && !bot.busy && (
          <button
            onClick={onStartEdit}
            aria-label="编辑消息"
            className="rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            title="编辑消息"
          >
            <Pencil size={14} />
          </button>
        )}
        {message.kind === "text" && (
          <button onClick={() => onReply(message)} aria-label="回复消息" title="回复消息" className="rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
            <Reply size={14} />
          </button>
        )}
        {user && message.kind === "text" && <ReactionBar threadId={bot.threadId} message={message} />}
        {user && <CopyButton text={text} />}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
            user
              ? "user-message-width whitespace-pre-wrap bg-bubble-user text-ink"
              : "assistant-message-surface assistant-message-width text-ink",
          )}
          title={new Date(message.at).toLocaleString()}
        >
          {user ? (
            <>
              {message.replyTo && <ReplyQuote reference={message.replyTo} onOpen={(id) => dispatch({ type: "focusMessage", threadId: bot.threadId, messageId: id })} />}
              {attachedImages && attachedImages.images.length > 0 && (
                <div className="mb-2 flex flex-wrap justify-end gap-2">
                  {attachedImages.images.map((path) => {
                    const src = `/api/attachments/${encodeURIComponent(attachmentBasename(path))}`;
                    return <a key={path} href={src} target="_blank" rel="noreferrer" className="block max-w-[260px] overflow-hidden rounded-lg border border-hairline/40">
                      <img src={src} alt="图片附件" loading="lazy" className="block max-h-[220px] w-full object-cover" />
                    </a>;
                  })}
                </div>
              )}
              <div
                className={cn(collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
              >
                {visibleText}
              </div>
              {collapsible && (
                <button onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  展开完整消息
                </button>
              )}
              {expanded && (
                <button onClick={() => setExpanded(false)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  收起
                </button>
              )}
            </>
          ) : (
            <>
              {message.replyTo && <ReplyQuote reference={message.replyTo} onOpen={(id) => dispatch({ type: "focusMessage", threadId: bot.threadId, messageId: id })} />}
              <MessageBoundary fallbackText={text}>
                <ChatMarkdown text={text} />
              </MessageBoundary>
            </>
          )}
        </div>
        {!user && (
          <div className="flex flex-col gap-0.5 self-end pb-0.5">
            {message.kind === "text" && <SpeakButton botId={bot.id} messageId={message.id} text={text} />}
            <CopyButton text={text} />
            {isLastBotText && !bot.busy && onRegenerate && (
              <button
                onClick={onRegenerate}
                aria-label="重新生成回复"
                title="重新生成回复"
                className="rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        )}
        {!user && message.kind === "text" && <ReactionBar threadId={bot.threadId} message={message} />}
        <span
          className={cn(
            "self-end pb-1 text-[11px] tabular-nums text-ink-secondary/70 opacity-0 transition-opacity group-hover:opacity-100",
            user ? "order-first mr-1" : "ml-1",
          )}
        >
          {formatTime(message.at)}
        </span>
      </div>
      <ReactionChips threadId={bot.threadId} message={message} align={user ? "right" : "left"} />
      {versions.length > 1 && (
        <div className="mt-1 flex items-center gap-0.5 pr-1 text-[12px] text-ink-secondary">
          <button
            onClick={() => switchTo(versions[versionIndex - 1])}
            disabled={versionIndex <= 0 || bot.busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title="上一版本"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">
            {versionIndex + 1}/{versions.length}
          </span>
          <button
            onClick={() => switchTo(versions[versionIndex + 1])}
            disabled={versionIndex >= versions.length - 1 || bot.busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title="下一版本"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A tool run: spinner while live, check/cross once settled. */
function ActivityChip({ message }: { message: Message }) {
  const { dispatch } = useStore();
  const tool = message.tool;
  if (!tool) return null;
  // bot⇄bot comm chip: opens the channel where the exchange lives
  const comm = message.comm;
  if (comm) {
    return (
      <div className="flex justify-start">
        <button
          onClick={() => dispatch({ type: "select", id: comm.groupId })}
          title={`打开与 ${comm.withName} 的对话`}
          className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <MausAvatar color={comm.withColor} state="happy" size={16} />
          <span className="max-w-[480px] truncate">{tool.name}</span>
          <ChevronRight size={13} />
        </button>
      </div>
    );
  }
  const failed = tool.ok === false;
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px]",
          failed ? "text-danger" : "text-ink-secondary",
        )}
      >
        {tool.ok === undefined ? (
          <Loader2 size={13} className="animate-spin" />
        ) : failed ? (
          <X size={13} />
        ) : (
          <Check size={13} className="text-success" />
        )}
        <span className="max-w-[480px] truncate font-mono">{tool.name}</span>
      </div>
    </div>
  );
}

function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  return (
    <div className="flex justify-start">
      <img
        src={`data:${mime ?? "image/png"};base64,${png}`}
        alt={zhCN.chat.botComputer}
        className="assistant-message-width rounded-2xl border border-hairline/40"
      />
    </div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  // markdown re-parses on a deferred value: when tokens arrive faster than
  // the parser keeps up, React lags the parse instead of janking the frame
  const deferred = useDeferredValue(text);
  return (
    <div className="flex w-full justify-start">
      <div className="assistant-message-surface assistant-message-width rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <MessageBoundary fallbackText={deferred}>
          <ChatMarkdown text={deferred} streaming />
        </MessageBoundary>
        <span className="animate-caret ml-0.5 inline-block h-[14px] w-[2px] bg-ink align-middle" />
      </div>
    </div>
  );
}

/** "Working for 12s" that ticks by mutating textContent on an interval —
 * no React commit per second while a turn streams (upstream trick). */
function WorkingTimer({ since }: { since: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = `已运行 ${Math.max(0, Math.round((Date.now() - since) / 1000))} 秒`;
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);
  return <span ref={ref} className="text-[12.5px] text-ink-secondary" />;
}

/** The settled transcript, memoized as one unit: during streaming every
 * frame re-renders ChatView, but all of these props keep their identity
 * (bot/messages only change on real message events), so the whole list —
 * every markdown tree, every code block — bails out of React work and only
 * the streaming tail below it commits. This is the t3code structural-sharing
 * idea at component granularity. */
const MessagesList = memo(function MessagesList({
  bot,
  messages,
  editingId,
  lastBotTextId,
  canRetryLast,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onReply,
  findMatchId,
}: {
  bot: Bot;
  messages: Message[];
  editingId: string | null;
  lastBotTextId: string | undefined;
  canRetryLast: boolean;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  onRegenerate: () => void;
  onReply: (message: Message) => void;
  findMatchId: string | null;
}) {
  return (
    <>
      {messages.length === 0 && !bot.busy && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
          <MausAvatar color={bot.color} image={bot.avatarImage} shape={bot.mascotShape} state="idle" size={64} motion="none" motionKey={0} />
          <div className="text-[17px] font-semibold text-ink">{bot.name}</div>
          <div className="max-w-[360px] text-[14px] text-ink-secondary">
            {bot.description || "发送一条消息开始对话。"}
          </div>
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
        const row = (() => {
          switch (m.kind) {
            case "options":
              // a live permission ask gets the approval box; questions and
              // the onboarding quiz keep the list card
              return m.card?.requestId && m.card.tool ? (
                <ApprovalCard bot={bot} message={m} />
              ) : (
                <OptionCard botId={bot.id} message={m} />
              );
            case "activity":
              // a failed turn is an error, not a tool run — render it as one
              return m.tool?.name.startsWith("error:") ? (
                <ErrorRow
                  message={m.tool.name.slice(6).trim()}
                  onRetry={m.id === messages.at(-1)?.id && canRetryLast ? onRegenerate : undefined}
                />
              ) : (
                <ActivityChip message={m} />
              );
            case "screen":
              return m.png ? <ScreenFrame png={m.png} mime={m.mime} /> : null;
            default:
              return (
                <Bubble
                  bot={bot}
                  message={m}
                  editing={editingId === m.id}
                  isLastBotText={m.id === lastBotTextId}
                  onStartEdit={() => onStartEdit(m.id)}
                  onCancelEdit={onCancelEdit}
                  onSubmitEdit={(text) => onSubmitEdit(m.id, text)}
                  onRegenerate={onRegenerate}
                  onReply={onReply}
                />
              );
          }
        })();
        if (!row) return null;
        return (
          <div
            key={m.id}
            data-message-id={m.id}
            data-find-current={m.id === findMatchId ? "true" : undefined}
            className={m.id === findMatchId ? "rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-app" : "contents"}
          >
            {newDay && <DaySeparator at={m.at} />}
            {row}
          </div>
        );
      })}
    </>
  );
});

export function ChatView({
  bot,
  reserveWindowControls = true,
  compactHeader = false,
}: {
  bot: Bot;
  reserveWindowControls?: boolean;
  compactHeader?: boolean;
}) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const stream = useStreaming();
  const streaming = stream.streaming[bot.threadId];
  const reasoning = stream.reasoning[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  const computerActivity = state.computerActivity[bot.id];
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;

  // only the active branch is rendered; forks stay reachable via ‹ › nav
  const messages = useMemo(() => visibleMessages(bot), [bot]);
  const transcriptKey = `${bot.id}:${bot.threadId}`;
  const [transcriptWindow, setTranscriptWindow] = useState(() => ({
    key: transcriptKey,
    start: tailWindowStart(messages.length),
  }));
  if (transcriptWindow.key !== transcriptKey) {
    setTranscriptWindow({ key: transcriptKey, start: tailWindowStart(messages.length) });
  }
  const {
    visible: windowedMessages,
    hiddenCount,
    startIndex,
  } = useMemo(
    () => resolveTranscriptWindow(messages, transcriptWindow.start),
    [messages, transcriptWindow.start],
  );
  const workStatus = useMemo(
    () => deriveWorkStatus({ bot, messages, streaming, reasoning, computerActivity }),
    [bot, messages, streaming, reasoning, computerActivity],
  );
  const globalError = state.error ? actionableRuntimeError(state.error) : null;
  const lastBotTextId = useMemo(
    () => [...messages].reverse().find((m) => m.role === "bot" && m.kind === "text")?.id,
    [messages],
  );
  const [callOpen, setCallOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);
  const autoSpokenRef = useRef<string | undefined>(lastBotTextId);
  useEffect(() => {
    setCallOpen(false);
    voiceSpeaker.stop();
    autoSpokenRef.current = lastBotTextId;
  }, [bot.id]);
  useEffect(() => {
    if (!lastBotTextId || autoSpokenRef.current === lastBotTextId) return;
    autoSpokenRef.current = lastBotTextId;
    if (!state.config?.voice?.autoSpeak || callOpen) return;
    const reply = messages.find((message) => message.id === lastBotTextId);
    if (reply?.text) void voiceSpeaker.speak(reply.text, { botId: bot.id, messageId: reply.id });
  }, [bot.id, callOpen, lastBotTextId, messages, state.config?.voice?.autoSpeak]);

  // one message at a time may be in edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyReference | null>(null);
  useEffect(() => setEditingId(null), [bot.id]);
  useEffect(() => setReplyTo(null), [bot.id, bot.threadId]);
  const chooseReply = useCallback((message: Message) => {
    if (!message.text || message.kind !== "text") return;
    setReplyTo({ messageId: message.id, role: message.role, text: message.text, at: message.at, author: message.role === "bot" ? bot.name : "你" });
  }, [bot.name]);
  const clearReply = useCallback(() => setReplyTo(null), []);
  const findMatches = useMemo(() => {
    const query = findQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return messages.filter((message) => {
      const searchable = [message.text, message.tool?.name, message.card?.title, message.card?.subtitle]
        .filter(Boolean)
        .join("\n")
        .toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [findQuery, messages]);
  const currentFindMessage = findMatches.length ? findMatches[Math.min(findIndex, findMatches.length - 1)] : undefined;
  useEffect(() => {
    if (!findOpen) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen]);
  useEffect(() => {
    setFindIndex(0);
  }, [findQuery, bot.id]);
  useEffect(() => {
    if (!jumpMessageId || findQuery.trim()) setJumpMessageId(null);
  }, [findQuery, jumpMessageId]);
  useEffect(() => {
    const request = state.messageFocus;
    if (!request || request.threadId !== bot.threadId) return;
    const messageIndex = messages.findIndex((message) => message.id === request.messageId);
    if (messageIndex < 0) return;
    setJumpMessageId(request.messageId);
    setFollow(false);
    setTranscriptWindow({ key: transcriptKey, start: Math.max(0, messageIndex - 20) });
    dispatch({ type: "clearMessageFocus", nonce: request.nonce });
  }, [bot.threadId, dispatch, messages, state.messageFocus, transcriptKey]);
  const targetMessageId = currentFindMessage?.id ?? jumpMessageId;
  useEffect(() => {
    if (!targetMessageId) return;
    const messageIndex = messages.findIndex((message) => message.id === targetMessageId);
    const visibleStart = transcriptWindow.start;
    const visibleEnd = visibleStart + windowedMessages.length;
    if (messageIndex >= 0 && (messageIndex < visibleStart || messageIndex >= visibleEnd)) {
      setFollow(false);
      setTranscriptWindow({ key: transcriptKey, start: Math.max(0, messageIndex - 20) });
      return;
    }
    const escapedId = globalThis.CSS?.escape?.(targetMessageId) ?? targetMessageId.replace(/(["\\])/g, "\\$1");
    const row = document.querySelector(`[data-message-id="${escapedId}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [messages, targetMessageId, transcriptKey, transcriptWindow.start, windowedMessages.length]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      } else if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        setFindOpen(false);
        setFindQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);
  // stable handler identities — MessagesList is memo'd on them
  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const submitEdit = useCallback(
    (messageId: string, text: string) => {
      setEditingId(null); // closes the editor first — a double Enter can't fork twice
      dispatch({ type: "editMessage", botId: bot.id, messageId, text });
    },
    [bot.id, dispatch],
  );
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user" && m.kind === "text"),
    [messages],
  );
  // regenerate = fork the last user message with the same text — reuses the
  // existing branch machinery, so the old answer stays reachable via ‹ ›
  const regenerate = useCallback(() => {
    if (lastUserMessage?.text && !bot.busy) {
      dispatch({ type: "editMessage", botId: bot.id, messageId: lastUserMessage.id, text: lastUserMessage.text });
    }
  }, [lastUserMessage, bot.busy, bot.id, dispatch]);

  // Scroll pinning: follow the bottom while the user hasn't scrolled away.
  // Follow breaks ONLY on an upward user gesture (wheel/touch), never on
  // scroll position checks — streamed content growth flickers "at bottom"
  // false for a frame, and breaking there kills follow permanently
  // (upstream-verified failure). Scrolling back to the end re-arms it.
  const [follow, setFollow] = useState(true);
  const touchY = useRef(0);

  useEffect(() => setFollow(true), [bot.id]);
  useEffect(() => {
    if (follow) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, messages.length, streaming, reasoning, bot.busy, follow]);

  // keyboard is a scroll gesture too (upstream lesson): PageUp/Home break
  // follow like an upward wheel; the at-end onScroll check re-arms it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PageUp" || (e.key === "Home" && !(e.target instanceof HTMLTextAreaElement))) setFollow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const jumpToLatest = () => {
    setFollow(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  // Prepending older rows must keep the message under the cursor stationary.
  const preExpandHeight = useRef<number | null>(null);
  const showEarlier = () => {
    preExpandHeight.current = scrollRef.current?.scrollHeight ?? null;
    setFollow(false);
    setTranscriptWindow((window) => ({
      key: window.key,
      start: expandWindowStart(startIndex),
    }));
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || preExpandHeight.current === null) return;
    element.scrollTop += element.scrollHeight - preExpandHeight.current;
    preExpandHeight.current = null;
  }, [transcriptWindow.start]);

  // on Windows the frameless window's min/max/close overlay sits at the
  // top-right: the header becomes the drag strip and clears room for it
  const isWin = window.ogb?.platform === "win32";
  const drag = isWin ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDrag = isWin ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between py-3",
          compactHeader ? "px-3" : "px-5",
          isWin && reserveWindowControls && "pr-[148px]",
        )}
        style={drag}
      >
        <button
          onClick={() => dispatch({ type: "toggleSettings" })}
          className={cn(
            "flex min-w-0 shrink-0 items-center rounded-lg px-1.5 py-1 hover:bg-raised/50",
            compactHeader ? "gap-0" : "gap-2.5",
          )}
          title={zhCN.chat.botSettings}
          style={noDrag}
        >
          <MausAvatar
            color={bot.color}
            image={bot.avatarImage}
            shape={bot.mascotShape}
            state={stateForBot({ ...bot, messages })}
            size={28}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
          <span className={cn("min-w-0 text-left", compactHeader && "hidden")}>
            <span className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-ink">
              <span className="truncate">{bot.name}</span>
              {bot.chiefOfStaff && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/12 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                  <Crown size={10} /> {zhCN.settings.chiefOfStaff}
                </span>
              )}
            </span>
            {workStatus && (
              <span className="flex items-center gap-1 text-[11px] font-normal text-ink-secondary" aria-live="polite">
                <Loader2 size={10} className="animate-spin" />
                <span className="truncate">{workStatus.label}{workStatus.detail ? ` · ${workStatus.detail}` : ""}</span>
              </span>
            )}
          </span>
        </button>
        <div className={cn("flex min-w-0 items-center", compactHeader ? "gap-1" : "gap-2")} style={noDrag}>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            title="搜索聊天记录（Ctrl+F）"
            aria-label="搜索聊天记录"
          >
            <Search size={17} />
          </button>
          {bot.busy && (
            <button
              onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
              className="flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
              title="停止当前任务"
            >
              <Square size={12} className="fill-current" />
              {zhCN.chat.stop}
            </button>
          )}
          {!compactHeader && <TaskPicker bot={bot} />}
          <ModelPicker bot={bot} />
          <CallButton bot={bot} active={callOpen} onToggle={() => setCallOpen((open) => !open)} />
          <button
            onClick={() => dispatch({ type: "toggleComputer" })}
            className={cn(
              "rounded-md p-1.5 hover:bg-raised",
              state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={zhCN.chat.botComputer}
          >
            <Monitor size={18} />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {state.error && (
        <div className={cn("conversation-content mx-auto w-full", compactHeader ? "px-3" : "px-5")}>
          <div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            <div className="font-medium">{globalError?.summary}</div>
            <div className="mt-0.5 text-[12px] text-danger/85">{globalError?.hint}</div>
          </div>
        </div>
      )}

      <TaskTimeline messages={messages} busy={bot.busy ?? false} onJump={(messageId) => dispatch({ type: "focusMessage", threadId: bot.threadId, messageId })} />
      <HandoffStrip bot={bot} />

      {/* Messages */}
      <div
        ref={scrollRef}
        className={cn("flex-1 overflow-y-auto [overflow-anchor:none]", compactHeader ? "px-3" : "px-5")}
        onWheel={(e) => {
          if (e.deltaY < 0) setFollow(false);
          else if (atEnd()) setFollow(true);
        }}
        onTouchStart={(e) => (touchY.current = e.touches[0]?.clientY ?? 0)}
        onTouchMove={(e) => {
          const y = e.touches[0]?.clientY ?? 0;
          if (y > touchY.current + 4) setFollow(false);
          else if (atEnd()) setFollow(true);
        }}
        onScroll={() => {
          if (!follow && atEnd()) setFollow(true);
        }}
      >
        <div
          className="conversation-content mx-auto flex flex-col gap-3 pb-4"
          role="log"
          aria-live="polite"
          aria-label={`与 ${bot.name} 的对话`}
        >
          {hiddenCount > 0 && (
            <div className="flex justify-center pt-2">
              <button
                onClick={showEarlier}
                className="ui-pressable rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                显示更早消息（还有 {hiddenCount} 条）
              </button>
            </div>
          )}
          <MessagesList
            bot={bot}
            messages={windowedMessages}
            editingId={editingId}
            lastBotTextId={lastBotTextId}
            canRetryLast={!bot.busy && Boolean(lastUserMessage)}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onSubmitEdit={submitEdit}
            onRegenerate={regenerate}
            onReply={chooseReply}
            findMatchId={targetMessageId}
          />
          {provisioning && workStatus?.kind === "computer" && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
                <Loader2 size={13} className="animate-spin" />
                {workStatus.label}
              </div>
            </div>
          )}
          {reasoning && bot.busy && <ThinkingStrip text={reasoning} active={!streaming} />}
          {streaming ? (
            <StreamingBubble text={streaming} />
          ) : (
            bot.busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2.5 rounded-2xl bg-raised px-4 py-3">
                   <Loader2 size={14} className="animate-spin text-ink-secondary" />
                   <span className="min-w-0">
                     <span className="block text-[12.5px] text-ink">{workStatus?.label ?? "正在工作"}</span>
                     <span className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
                       {workStatus?.detail && <span className="max-w-[300px] truncate">{workStatus.detail}</span>}
                       <WorkingTimer since={lastUserMessage?.at ?? Date.now()} />
                     </span>
                   </span>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Reading scrollback — one tap back to the end, streaming or not */}
      {!follow && (
        <button
          onClick={jumpToLatest}
          aria-label="跳到最新消息"
          className="animate-pop-in absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-hairline/40 bg-raised px-3 py-1.5 text-[12.5px] text-ink shadow-lg hover:bg-raised-hover"
        >
          <ArrowDown size={13} /> 跳到最新消息
        </button>
      )}

      {callOpen && <CallOverlay bot={bot} onHangup={() => setCallOpen(false)} />}

      {findOpen && (
        <div className="absolute right-4 top-14 z-20 flex w-[min(360px,calc(100%-2rem))] items-center gap-1.5 rounded-xl border border-hairline/50 bg-panel/95 p-1.5 shadow-xl backdrop-blur">
          <Search size={15} className="ml-1 text-ink-secondary" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setFindOpen(false);
                setFindQuery("");
              } else if (event.key === "Enter" && findMatches.length) {
                event.preventDefault();
                setFindIndex((index) => (index + (event.shiftKey ? -1 : 1) + findMatches.length) % findMatches.length);
              }
            }}
            aria-label="搜索聊天记录"
            placeholder="搜索聊天记录"
            className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[13px] text-ink outline-none placeholder:text-ink-secondary"
            spellCheck={false}
          />
          {findQuery.trim() && <span className="shrink-0 px-1 text-[11px] tabular-nums text-ink-secondary">{findMatches.length ? `${Math.min(findIndex + 1, findMatches.length)}/${findMatches.length}` : "无结果"}</span>}
          <button
            type="button"
            disabled={!findMatches.length}
            onClick={() => setFindIndex((index) => (index - 1 + findMatches.length) % findMatches.length)}
            aria-label="上一个匹配"
            className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            disabled={!findMatches.length}
            onClick={() => setFindIndex((index) => (index + 1) % findMatches.length)}
            aria-label="下一个匹配"
            className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => { setFindOpen(false); setFindQuery(""); }}
            aria-label="关闭搜索"
            className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* keyed by bot: a draft belongs to the conversation it was typed in,
          so switching bots starts from an empty composer instead of carrying
          the previous bot's half-written message over. ArrowUp-to-edit is
          gated on busy like the pencil button — editing rewinds the thread,
          which a live turn forbids (the server 409s it). */}
      <Composer
        key={bot.threadId}
        bot={bot}
        compact={compactHeader}
        onEditLast={lastUserMessage && !bot.busy ? () => setEditingId(lastUserMessage.id) : undefined}
        replyTo={replyTo}
        onClearReply={clearReply}
      />

    </main>
  );
}
