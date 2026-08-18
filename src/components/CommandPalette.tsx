import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot as BotIcon, MessageSquare, Search, Users } from "lucide-react";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { rankByName } from "@/lib/palette-rank";
import { cn } from "@/lib/cn";

interface MessageHit {
  threadId: string;
  messageId: string;
  at: number;
  role: string;
  snippet: string;
  name: string;
  botId?: string;
  groupId?: string;
  task?: string;
}

type PaletteEntry =
  | { kind: "bot"; bot: Bot }
  | { kind: "room"; group: Group }
  | { kind: "message"; hit: MessageHit };

export function CommandPalette() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<MessageHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMessageHits([]);
    setCursor(0);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  useEffect(() => {
    if (!open || !normalizedQuery) {
      setMessageHits([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(normalizedQuery)}&limit=12`)
        .then((result: { hits?: MessageHit[] }) => {
          if (alive) setMessageHits(result.hits ?? []);
        })
        .catch(() => {
          if (alive) setMessageHits([]);
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, normalizedQuery]);

  useEffect(() => {
    setCursor(0);
  }, [normalizedQuery]);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, messageHits]);

  if (!open) return null;

  const bots = rankByName(state.bots.filter((bot) => !bot.hidden), normalizedQuery);
  const rooms = rankByName(state.groups, normalizedQuery);
  const entries: PaletteEntry[] = [
    ...bots.map((bot): PaletteEntry => ({ kind: "bot", bot })),
    ...rooms.map((group): PaletteEntry => ({ kind: "room", group })),
    ...(normalizedQuery ? messageHits.map((hit): PaletteEntry => ({ kind: "message", hit })) : []),
  ];
  const selected = entries.length ? Math.min(cursor, entries.length - 1) : 0;

  const activate = (entry: PaletteEntry) => {
    if (entry.kind === "message") {
      const id = entry.hit.botId ?? entry.hit.groupId;
      if (!id) return;
      dispatch({ type: "select", id });
      const targetBot = entry.hit.botId ? state.bots.find((bot) => bot.id === entry.hit.botId) : undefined;
      if (targetBot && targetBot.threadId !== entry.hit.threadId) {
        dispatch({ type: "switchTask", botId: targetBot.id, threadId: entry.hit.threadId });
      }
    } else {
      dispatch({ type: "select", id: entry.kind === "bot" ? entry.bot.id : entry.group.id });
    }
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor(entries.length ? (selected + 1) % entries.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(entries.length ? (selected - 1 + entries.length) % entries.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[selected];
      if (entry) activate(entry);
    }
  };

  const roomOffset = bots.length;
  const messageOffset = bots.length + rooms.length;
  const row = (key: string, index: number, onPick: () => void, children: ReactNode, twoLine = false) => (
    <button
      key={key}
      ref={index === selected ? selectedRef : undefined}
      onClick={onPick}
      onMouseMove={() => setCursor(index)}
      className={cn(
        "ui-pressable flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
        twoLine && "flex-col items-stretch gap-0.5",
        index === selected ? "bg-raised" : "hover:bg-raised/50",
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 p-4 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        className="animate-pop-in flex max-h-[min(500px,72vh)] w-full max-w-[580px] flex-col overflow-hidden rounded-2xl border border-hairline/60 bg-card shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-hairline/40 px-4 py-3.5">
          <Search size={17} className="shrink-0 text-ink-secondary" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索机器人、群聊或聊天消息…"
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <kbd className="shrink-0 rounded-md border border-hairline/50 bg-panel px-1.5 py-0.5 text-[11px] text-ink-secondary">
            Esc
          </kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] text-ink-secondary">
              {normalizedQuery ? `没有找到“${query}”` : "暂无可切换内容"}
            </div>
          )}
          {bots.length > 0 && <SectionLabel>机器人</SectionLabel>}
          {bots.map((bot, index) =>
            row(`bot:${bot.id}`, index, () => activate({ kind: "bot", bot }), (
              <>
                <BotIcon size={16} className="shrink-0 text-ink-secondary" />
                <span className="truncate text-[14px] text-ink">{bot.name}</span>
                {bot.title && <span className="min-w-0 truncate text-[12.5px] text-ink-secondary">{bot.title}</span>}
              </>
            )),
          )}
          {rooms.length > 0 && <SectionLabel>群聊</SectionLabel>}
          {rooms.map((group, index) =>
            row(`room:${group.id}`, roomOffset + index, () => activate({ kind: "room", group }), (
              <>
                <Users size={16} className="shrink-0 text-ink-secondary" />
                <span className="truncate text-[14px] text-ink">{group.name}</span>
              </>
            )),
          )}
          {normalizedQuery && messageHits.length > 0 && <SectionLabel>聊天消息</SectionLabel>}
          {normalizedQuery && messageHits.map((hit, index) =>
            row(`msg:${hit.threadId}:${hit.messageId}`, messageOffset + index, () => activate({ kind: "message", hit }), (
              <>
                <span className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
                  <MessageSquare size={13} className="shrink-0 text-ink-secondary" />
                  {hit.name}
                  {hit.task ? <span className="font-normal text-ink-secondary">· {hit.task}</span> : null}
                </span>
                <span className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-secondary">{hit.snippet}</span>
              </>
            ), true),
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-hairline/40 px-4 py-2 text-[11px] text-ink-secondary">
          <span>↑↓ 选择</span><span>Enter 打开</span><span>Ctrl K 关闭</span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[11px] font-medium tracking-[0.08em] text-ink-secondary">{children}</div>;
}
