import { ArrowUpRight, X } from "lucide-react";
import type { ReplyReference } from "@/state/store";
import { cn } from "@/lib/cn";

function compactText(text: string, limit: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

export function ReplyQuote({ reference, onOpen }: { reference: ReplyReference; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(reference.messageId)}
      className="mb-1.5 flex max-w-full items-center gap-1.5 rounded-lg border-l-2 border-accent/60 bg-raised/45 px-2 py-1 text-left text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
      aria-label="跳转到被回复的消息"
    >
      <ArrowUpRight size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">{reference.author ? `${reference.author}：` : "回复："}{compactText(reference.text, 96)}</span>
    </button>
  );
}

export function ReplyComposerPill({ reference, onClear }: { reference: ReplyReference; onClear: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-[12.5px] text-ink-secondary" role="status" aria-label="正在回复消息">
      <ArrowUpRight size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">回复{reference.author ? ` ${reference.author}` : ""}：“{compactText(reference.text, 96)}”</span>
      <button type="button" onClick={onClear} className={cn("rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink")} aria-label="取消回复">
        <X size={14} />
      </button>
    </div>
  );
}
