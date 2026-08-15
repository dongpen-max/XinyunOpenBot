import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function SettingsDisclosure({
  icon: Icon,
  title,
  description,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentId = `settings-${title.replace(/\s+/g, "-")}`;
  return (
    <section className="overflow-hidden rounded-xl border border-hairline/35 bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-border"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-ink">{title}</span>
            {!open && summary && <span className="truncate text-[11px] text-ink-secondary/75">{summary}</span>}
          </span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-secondary">{description}</span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && (
        <div id={contentId} className="border-t border-hairline/30 p-4">
          {children}
        </div>
      )}
    </section>
  );
}
