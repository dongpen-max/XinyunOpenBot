// A room: several bots + you in one shared thread. Avatars inside the room
// stay still so a busy group does not become a wall of competing motion.
// Plain messages go to the room's default responder; @mentions override it.
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ChevronDown, Pin, Reply, UserMinus, UserPlus, UsersRound, X } from "lucide-react";
import {
  useStore,
  useStreaming,
  formatTime,
  type Bot,
  type Group,
  type GroupDefaultResponder,
  type Message,
  type ReplyReference,
} from "@/state/store";
import { MausAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";
import { effectiveDefaultResponder, groupResponseHint } from "@/lib/group-routing";
import { ChatMarkdown } from "./ChatMarkdown";
import { Composer } from "./Composer";
import { ReactionBar, ReactionChips } from "./Reactions";
import { ApprovalCard } from "./ApprovalCard";
import { cn } from "@/lib/cn";
import { SpeakButton } from "./VoiceControls";
import { GroupCallButton, GroupCallOverlay } from "./GroupVoiceControls";
import { addGroupMember, canRemoveGroupMember, removeGroupMember } from "@/lib/group-membership";
import { expandWindowStart, resolveTranscriptWindow, tailWindowStart } from "@/lib/transcript-window";
import { ReplyQuote } from "./ReplyPreview";

function dayLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function SenderAvatar({ bot, color, hidden = false }: { bot?: Bot; color: string; hidden?: boolean }) {
  return (
    <div className={cn("flex w-8 shrink-0 justify-center pt-[18px]", hidden && "invisible")} aria-hidden={hidden || undefined}>
      <MausAvatar
        color={(bot?.color ?? color) as Bot["color"]}
        image={bot?.avatarImage}
        shape={bot?.mascotShape}
        state={normalizeState(bot?.mascotExpression) ?? "happy"}
        size={30}
        motion="none"
        motionKey={0}
        animated={false}
      />
    </div>
  );
}

function GroupHeaderAvatars({ members, busyBotId, compact }: { members: Bot[]; busyBotId?: string | null; compact: boolean }) {
  const shown = members.slice(0, compact ? 2 : 3);
  const extra = members.length - shown.length;
  return (
    <div className="flex shrink-0 items-center -space-x-2" aria-label={`${members.length} 个群聊机器人`}>
      {shown.map((member, index) => (
        <span
          key={member.id}
          title={`${member.name}${busyBotId === member.id ? " — 正在工作…" : ""}`}
          className={cn(
            "relative inline-flex rounded-full ring-2 ring-app transition-transform duration-150",
            busyBotId === member.id && "z-10 ring-accent/70",
          )}
          style={{ zIndex: shown.length - index }}
        >
          <MausAvatar
            color={member.color}
            image={member.avatarImage}
            shape={member.mascotShape}
            state={normalizeState(member.mascotExpression) ?? "happy"}
            size={compact ? 24 : 28}
            motion="none"
            animated={false}
          />
          {busyBotId === member.id && (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-app bg-accent" />
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="relative z-10 flex size-7 items-center justify-center rounded-full border-2 border-app bg-raised text-[10px] font-semibold tabular-nums text-ink-secondary">
          +{extra}
        </span>
      )}
    </div>
  );
}

const Transcript = memo(function Transcript({
  group,
  members,
  messages,
  highlightMessageId,
  onReply,
  onOpenReply,
}: {
  group: Group;
  members: Bot[];
  messages: Message[];
  highlightMessageId?: string | null;
  onReply: (message: Message) => void;
  onOpenReply: (messageId: string) => void;
}) {
  const memberOf = (id?: string) => members.find((b) => b.id === id);
  const textMessages = messages;
  return (
    <>
      {textMessages.map((m, i) => {
        const prev = textMessages[i - 1];
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
        const user = m.role === "user";
        const senderBot = memberOf(m.from?.botId);
        const newCluster = !prev || prev.role !== m.role || prev.from?.botId !== m.from?.botId || newDay;
        const row =
          // a member can hit a permission ask mid-turn; without this the
          // card never rendered here and the bot waited out its timeout.
          // `tool` distinguishes a permission from a QUESTION — a question
          // only accepts an "answer", so routing it here would offer an
          // Allow the broker rejects
          m.kind === "options" && m.card?.requestId && m.card.tool ? (
            <div className="flex justify-start">
              <ApprovalCard bot={memberOf(m.from?.botId)} message={m} />
            </div>
          ) : m.kind === "activity" && m.tool ? (
            <div className="flex justify-start">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px]",
                  m.tool.ok === false ? "text-danger" : "text-ink-secondary",
                )}
              >
                <span className="max-w-[480px] truncate font-mono">{m.tool.name}</span>
              </div>
            </div>
          ) : m.kind === "text" && m.text ? user ? (
            <div className="group flex w-full flex-col items-end">
              <div className="flex w-full items-end justify-end gap-1.5">
                <button onClick={() => onReply(m)} aria-label="回复消息" title="回复消息" className="rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"><Reply size={14} /></button>
                <ReactionBar threadId={group.threadId} message={m} />
                <div
                  className="user-message-width whitespace-pre-wrap rounded-[20px] bg-bubble-user px-4 py-2.5 text-[15px] leading-relaxed text-ink"
                  title={new Date(m.at).toLocaleString()}
                >
                  {m.replyTo && <ReplyQuote reference={m.replyTo} onOpen={onOpenReply} />}
                  {m.text}
                </div>
                <span className="self-end pb-1 text-[11px] tabular-nums text-ink-secondary/70 opacity-0 transition-opacity group-hover:opacity-100">
                  {formatTime(m.at)}
                </span>
              </div>
              <ReactionChips threadId={group.threadId} message={m} members={members} align="right" />
            </div>
          ) : (
            <article className={cn("group flex w-full items-start gap-2.5", newCluster ? "mt-1" : "-mt-1")} aria-label={`${m.from?.name ?? "机器人"} 的消息`}>
              <SenderAvatar bot={senderBot} color={m.from?.color ?? "blue"} hidden={!newCluster} />
              <div className="min-w-0 flex-1">
                {newCluster && (
                  <div className="mb-1 pl-0.5 text-[12.5px] font-medium leading-4 text-ink-secondary">
                    {m.from?.name}
                  </div>
                )}
                <div className="flex w-full flex-wrap items-end gap-1.5">
                  <div
                    className="assistant-message-surface assistant-message-width rounded-[20px] px-4 py-2.5 text-[15px] leading-relaxed text-ink"
                    title={new Date(m.at).toLocaleString()}
                  >
                    {m.replyTo && <ReplyQuote reference={m.replyTo} onOpen={onOpenReply} />}
                    <ChatMarkdown text={m.text} />
                  </div>
                  <div className="flex flex-col gap-0.5 self-end pb-0.5">
                    {senderBot && <SpeakButton botId={senderBot.id} messageId={m.id} text={m.text} />}
                    <button onClick={() => onReply(m)} aria-label="回复消息" title="回复消息" className="rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"><Reply size={14} /></button>
                    <ReactionBar threadId={group.threadId} message={m} />
                  </div>
                  <span className="self-end pb-1 text-[11px] tabular-nums text-ink-secondary/70 opacity-0 transition-opacity group-hover:opacity-100">
                    {formatTime(m.at)}
                  </span>
                </div>
                <ReactionChips threadId={group.threadId} message={m} members={members} align="left" />
              </div>
            </article>
          ) : null;
        if (!row) return null;
        return (
          <div
            key={m.id}
            data-message-id={m.id}
            className={m.id === highlightMessageId ? "rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-app" : "contents"}
          >
            {newDay && (
              <div className="py-3 text-center text-[13px] text-ink-secondary">
                {dayLabel(m.at)} {formatTime(m.at)}
              </div>
            )}
            {row}
          </div>
        );
      })}
    </>
  );
});

function StreamingBubble({ text }: { text: string }) {
  const deferred = useDeferredValue(text);
  return (
    <div className="flex w-full justify-start">
      <div className="assistant-message-surface assistant-message-width rounded-[20px] px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <ChatMarkdown text={deferred} streaming />
        <span className="animate-caret ml-0.5 inline-block h-[14px] w-[2px] bg-ink align-middle" />
      </div>
    </div>
  );
}

function DefaultResponderSelect({ group, members }: { group: Group; members: Bot[] }) {
  const { dispatch } = useStore();
  const responder = effectiveDefaultResponder(group, members);
  const value = responder.kind === "member" ? `member:${responder.botId}` : responder.kind;
  const lead = responder.kind === "member" ? members.find((member) => member.id === responder.botId) : undefined;
  const title =
    responder.kind === "everyone"
      ? "普通消息会发送给所有群成员；@提及会覆盖此设置"
      : responder.kind === "mentions"
        ? "只有明确被 @提及的机器人才会响应"
        : `普通消息默认由 ${lead?.name ?? "主机器人"} 响应；@提及会覆盖此设置`;

  const change = (nextValue: string) => {
    let next: GroupDefaultResponder;
    if (nextValue === "everyone") next = { kind: "everyone" };
    else if (nextValue === "mentions") next = { kind: "mentions" };
    else next = { kind: "member", botId: nextValue.slice("member:".length) };
    dispatch({ type: "patchGroup", groupId: group.id, patch: { defaultResponder: next } });
  };

  return (
    <div className="relative shrink-0" title={title}>
      <select
        aria-label="默认响应机器人"
        value={value}
        onChange={(event) => change(event.target.value)}
        className="h-8 max-w-[190px] appearance-none truncate rounded-full border border-hairline/40 bg-raised/60 py-1 pl-3 pr-7 text-[12.5px] font-medium text-ink outline-none transition-colors duration-150 hover:bg-raised focus:border-accent"
      >
        <optgroup label="默认机器人">
          {members.map((member) => (
            <option key={member.id} value={`member:${member.id}`}>
              默认：{member.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="群聊响应策略">
          <option value="everyone">所有机器人响应</option>
          <option value="mentions">仅响应 @提及</option>
        </optgroup>
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary"
      />
    </div>
  );
}

function GroupMemberManager({
  group,
  members,
  bots,
  compact,
}: {
  group: Group;
  members: Bot[];
  bots: Bot[];
  compact: boolean;
}) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const locked = Boolean(group.busyBotId);
  const available = bots.filter((bot) => !bot.hidden && !group.memberIds.includes(bot.id));

  useEffect(() => setOpen(false), [group.id]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const add = (botId: string) => {
    if (locked) return;
    dispatch({
      type: "patchGroup",
      groupId: group.id,
      patch: { memberIds: addGroupMember(group.memberIds, botId) },
    });
  };

  const remove = (botId: string) => {
    if (locked || !canRemoveGroupMember(group.memberIds, botId)) return;
    dispatch({
      type: "patchGroup",
      groupId: group.id,
      patch: { memberIds: removeGroupMember(group.memberIds, botId) },
    });
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "ui-pressable flex h-8 items-center justify-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 text-ink-secondary hover:bg-raised hover:text-ink",
          compact ? "w-8" : "px-2.5",
          open && "border-accent-border bg-raised text-ink",
        )}
        title="管理群聊机器人"
      >
        <UsersRound size={14} />
        {!compact && <span className="text-[12px] font-medium tabular-nums">{members.length}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="管理群聊机器人"
            className="absolute right-0 top-full z-40 mt-2 w-[320px] overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-2xl shadow-black/30"
          >
            <div className="flex items-center justify-between border-b border-hairline/35 px-4 py-3">
              <span>
                <span className="block text-[14px] font-semibold text-ink">群聊机器人</span>
                <span className="block text-[11px] text-ink-secondary">添加或移除参与这个群聊的机器人</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
                aria-label="关闭成员管理"
              >
                <X size={15} />
              </button>
            </div>

            {locked && (
              <div className="border-b border-hairline/30 bg-warning/10 px-4 py-2 text-[11.5px] text-warning">
                群聊正在运行，结束当前回复后才能调整成员。
              </div>
            )}

            <div className="max-h-[420px] overflow-y-auto p-2">
              <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                当前成员 · {members.length}
              </div>
              <div className="flex flex-col gap-0.5">
                {members.map((member) => {
                  const removable = canRemoveGroupMember(group.memberIds, member.id) && !locked;
                  return (
                    <div key={member.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-raised/40">
                      <MausAvatar
                        color={member.color}
                        image={member.avatarImage}
                        shape={member.mascotShape}
                        state={normalizeState(member.mascotExpression) ?? "happy"}
                        size={30}
                        motion="none"
                        animated={false}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{member.name}</span>
                      <button
                        type="button"
                        onClick={() => remove(member.id)}
                        disabled={!removable}
                        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:text-ink-secondary disabled:opacity-45 disabled:hover:bg-transparent"
                        title={locked ? "群聊运行时不能移除成员" : removable ? `移除 ${member.name}` : "群聊至少需要一个机器人"}
                        aria-label={`从群聊移除 ${member.name}`}
                      >
                        <UserMinus size={13} /> 移除
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 border-t border-hairline/30 px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                添加机器人
              </div>
              {available.length ? (
                <div className="flex flex-col gap-0.5">
                  {available.map((bot) => (
                    <button
                      key={bot.id}
                      type="button"
                      onClick={() => add(bot.id)}
                      disabled={locked}
                      className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-raised/50 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <MausAvatar
                        color={bot.color}
                        image={bot.avatarImage}
                        shape={bot.mascotShape}
                        state={normalizeState(bot.mascotExpression) ?? "happy"}
                        size={30}
                        motion="none"
                        animated={false}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{bot.name}</span>
                      <span className="flex items-center gap-1 rounded-lg bg-accent/12 px-2 py-1.5 text-[11.5px] font-medium text-accent">
                        <UserPlus size={13} /> 加入
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-2 py-4 text-center text-[12px] text-ink-secondary">
                  所有可用机器人都已在群聊中。
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function GroupView({
  group,
  reserveWindowControls = true,
  compactHeader = false,
}: {
  group: Group;
  reserveWindowControls?: boolean;
  compactHeader?: boolean;
}) {
  const { state, dispatch } = useStore();
  const stream = useStreaming();
  const streaming = stream.streaming[group.threadId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const touchY = useRef(0);
  const [bulletinOpen, setBulletinOpen] = useState(false);
  const [bulletinDraft, setBulletinDraft] = useState(group.bulletin);
  const [callOpen, setCallOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyReference | null>(null);

  const members = useMemo(
    () => group.memberIds.map((id) => state.bots.find((b) => b.id === id)).filter((b): b is Bot => Boolean(b)),
    [group.memberIds, state.bots],
  );
  const speaker = members.find((b) => b.id === group.busyBotId);

  const transcriptKey = `${group.id}:${group.threadId}`;
  const [transcriptWindow, setTranscriptWindow] = useState(() => ({
    key: transcriptKey,
    start: tailWindowStart(group.messages.length),
  }));
  if (transcriptWindow.key !== transcriptKey) {
    setTranscriptWindow({ key: transcriptKey, start: tailWindowStart(group.messages.length) });
  }
  const {
    visible: windowedMessages,
    hiddenCount,
    startIndex,
  } = useMemo(
    () => resolveTranscriptWindow(group.messages, transcriptWindow.start),
    [group.messages, transcriptWindow.start],
  );
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);

  useEffect(() => {
    const request = state.messageFocus;
    if (!request || request.threadId !== group.threadId) return;
    const messageIndex = group.messages.findIndex((message) => message.id === request.messageId);
    if (messageIndex < 0) return;
    setJumpMessageId(request.messageId);
    setFollow(false);
    setTranscriptWindow({ key: transcriptKey, start: Math.max(0, messageIndex - 20) });
    dispatch({ type: "clearMessageFocus", nonce: request.nonce });
  }, [dispatch, group.messages, group.threadId, state.messageFocus, transcriptKey]);
  useEffect(() => {
    if (!jumpMessageId) return;
    const messageIndex = group.messages.findIndex((message) => message.id === jumpMessageId);
    const visibleEnd = transcriptWindow.start + windowedMessages.length;
    if (messageIndex >= 0 && (messageIndex < transcriptWindow.start || messageIndex >= visibleEnd)) return;
    const escapedId = globalThis.CSS?.escape?.(jumpMessageId) ?? jumpMessageId.replace(/(["\\])/g, "\\$1");
    document.querySelector(`[data-message-id="${escapedId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [group.messages, jumpMessageId, transcriptWindow.start, windowedMessages.length]);

  useEffect(() => setFollow(true), [group.id]);
  useEffect(() => setCallOpen(false), [group.id]);
  useEffect(() => setReplyTo(null), [group.id, group.threadId]);
  useEffect(() => setBulletinDraft(group.bulletin), [group.id, group.bulletin]);
  useEffect(() => {
    if (follow) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [group.id, group.messages.length, streaming, group.busyBotId, follow]);

  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

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

  const saveBulletin = () => {
    setBulletinOpen(false);
    if (bulletinDraft !== group.bulletin) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin: bulletinDraft } });
    }
  };

  const isWin = window.ogb?.platform === "win32";
  const drag = isWin ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDrag = isWin ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header: static member avatars; a ring and dot mark the working bot. */}
      <div
        className={cn(
          "flex items-center justify-between py-3",
          compactHeader ? "px-3" : "px-5",
          isWin && reserveWindowControls && "pr-[148px]",
        )}
        style={drag}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <GroupHeaderAvatars members={members} busyBotId={group.busyBotId} compact={compactHeader} />
          <span className={cn("min-w-0 truncate font-semibold text-ink", compactHeader ? "text-[14px]" : "text-[15px]")}>{group.name}</span>
        </div>
        <div className="flex items-center gap-1.5" style={noDrag}>
          {!group.dm && !compactHeader && <DefaultResponderSelect group={group} members={members} />}
          {!group.dm && (
            <GroupMemberManager
              group={group}
              members={members}
              bots={state.bots}
              compact={compactHeader}
            />
          )}
          {!group.dm && <GroupCallButton group={group} active={callOpen} onToggle={() => setCallOpen((open) => !open)} />}
        </div>
      </div>

      {/* Bulletin: one pinned line; click to edit */}
      <div className={cn("conversation-content mx-auto w-full", compactHeader ? "px-3" : "px-5")}>
        {bulletinOpen ? (
          <div className="mb-1 rounded-lg border border-hairline/40 bg-panel p-2">
            <textarea
              autoFocus
              value={bulletinDraft}
              onChange={(e) => setBulletinDraft(e.target.value)}
              onBlur={saveBulletin}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveBulletin();
                if (e.key === "Escape") {
                  setBulletinDraft(group.bulletin);
                  setBulletinOpen(false);
                }
              }}
              placeholder="Room instructions — every bot in this room follows them (who does what, tone, goals, a task checklist…)"
              rows={4}
              className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setBulletinOpen(true)}
            className="ui-pressable mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-raised/40"
            title="Room bulletin — shared instructions for every bot here"
          >
            <Pin size={12} className="shrink-0 text-ink-secondary" />
            <span className={cn("truncate text-[12.5px]", group.bulletin ? "text-ink-secondary" : "text-ink-secondary/60")}>
              {group.bulletin.split("\n")[0] || "Add room instructions…"}
            </span>
          </button>
        )}
      </div>

      {/* Transcript */}
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
          aria-label={`Room ${group.name}`}
        >
          {group.messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex -space-x-2">
                {members.slice(0, 3).map((b) => (
                  <MausAvatar
                    key={b.id}
                    color={b.color}
                    image={b.avatarImage}
                    shape={b.mascotShape}
                    state="happy"
                    size={44}
                    motion="none"
                    motionKey={0}
                    animated={false}
                  />
                ))}
              </div>
              <div className="text-[17px] font-semibold text-ink">{group.name}</div>
              <div className="max-w-[380px] text-[14px] text-ink-secondary">
                {groupResponseHint(group, members)}
              </div>
            </div>
          )}
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
          <Transcript
            group={group}
            members={members}
            messages={windowedMessages}
            highlightMessageId={jumpMessageId}
            onReply={(message) => message.text && setReplyTo({ messageId: message.id, role: message.role, text: message.text, at: message.at, author: message.role === "bot" ? (message.from?.name ?? "机器人") : "你" })}
            onOpenReply={(messageId) => dispatch({ type: "focusMessage", threadId: group.threadId, messageId })}
          />
          {speaker && !streaming && (
            <article className="flex w-full items-start gap-2.5">
              <SenderAvatar bot={speaker} color={speaker.color} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 pl-0.5 text-[12.5px] font-medium leading-4 text-ink-secondary">{speaker.name}</div>
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-[20px] bg-raised px-4 py-3">
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            </article>
          )}
          {speaker && streaming && (
            <article className="flex w-full items-start gap-2.5">
              <SenderAvatar bot={speaker} color={speaker.color} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 pl-0.5 text-[12.5px] font-medium leading-4 text-ink-secondary">{speaker.name}</div>
                <StreamingBubble text={streaming} />
              </div>
            </article>
          )}
        </div>
      </div>

      {!follow && (
        <button
          onClick={() => {
            setFollow(true);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
          }}
          aria-label="Jump to latest messages"
          className="animate-pop-in absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-hairline/40 bg-raised px-3 py-1.5 text-[12.5px] text-ink shadow-lg hover:bg-raised-hover"
        >
          <ArrowDown size={13} /> Jump to latest
        </button>
      )}

      <Composer key={group.id} group={group} members={members} compact={compactHeader} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      {callOpen && !group.dm && <GroupCallOverlay group={group} members={members} onHangup={() => setCallOpen(false)} />}
    </main>
  );
}
