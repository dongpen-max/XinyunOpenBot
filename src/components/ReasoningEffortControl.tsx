import { BrainCircuit, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/cn";
import type { ReasoningLevel } from "@/lib/drafts";
import {
  REASONING_LEVELS,
  reasoningLevelFromIndex,
  reasoningLevelIndex,
} from "@/lib/reasoning-effort";

export function ReasoningEffortControl({
  value,
  onChange,
  disabled,
  helperText,
}: {
  value: ReasoningLevel;
  onChange: (value: ReasoningLevel) => void;
  disabled?: boolean;
  helperText: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const index = reasoningLevelIndex(value);
  const level = REASONING_LEVELS[index];
  const isMaximum = index === REASONING_LEVELS.length - 1;
  const progress = `${(index / (REASONING_LEVELS.length - 1)) * 100}%`;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggle = () => {
    if (disabled) return;
    setOpen((previous) => {
      const next = !previous;
      if (next) requestAnimationFrame(() => sliderRef.current?.focus());
      return next;
    });
  };

  return (
    <div
      ref={rootRef}
      className="reasoning-effort-control relative mb-0.5 shrink-0"
      data-maximum={isMaximum ? "true" : "false"}
    >
      {open && (
        <div
          role="group"
          aria-label="模型思考强度"
          className="reasoning-effort-popover animate-pop-in absolute bottom-[calc(100%+12px)] left-0 z-30 w-[290px] rounded-2xl border border-hairline/60 bg-panel p-3.5 shadow-2xl"
        >
          <div className="mb-2.5 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <BrainCircuit size={15} aria-hidden="true" />
                思考强度
              </div>
              <p id={descriptionId} className="mt-1 text-[11px] leading-4 text-ink-secondary">
                {helperText}
              </p>
            </div>
            <span
              className={cn(
                "reasoning-effort-badge shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold",
                isMaximum
                  ? "reasoning-effort-badge--maximum"
                  : "border-hairline/60 bg-raised/50 text-ink",
              )}
            >
              {level.label}
              {isMaximum && <span className="ml-1 text-[9px] tracking-wide">MAX</span>}
            </span>
          </div>

          <div
            className="reasoning-slider"
            data-maximum={isMaximum ? "true" : "false"}
            style={{ "--reasoning-progress": progress } as CSSProperties}
          >
            <div className="reasoning-slider__shell">
              <div className="reasoning-slider__rail">
                <div className="reasoning-slider__fill" />
                <div className="reasoning-slider__sheen" aria-hidden="true" />
                <div className="reasoning-slider__particles" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, particleIndex) => (
                    <span key={particleIndex} className="reasoning-slider__particle" />
                  ))}
                </div>
                {REASONING_LEVELS.map((candidate, candidateIndex) => (
                  <span
                    key={candidate.value}
                    className="reasoning-slider__tick"
                    data-active={candidateIndex <= index ? "true" : "false"}
                    aria-hidden="true"
                  />
                ))}
                <span className="reasoning-slider__thumb" aria-hidden="true">
                  {isMaximum && (
                    <>
                      <span className="reasoning-slider__aura" />
                      <span className="reasoning-slider__orbit" />
                      <span className="reasoning-slider__spark reasoning-slider__spark--one" />
                      <span className="reasoning-slider__spark reasoning-slider__spark--two" />
                      <span className="reasoning-slider__spark reasoning-slider__spark--three" />
                    </>
                  )}
                  <span className="reasoning-slider__thumb-core">
                    {isMaximum && <Sparkles size={13} aria-hidden="true" />}
                  </span>
                </span>
              </div>
              <input
                ref={sliderRef}
                type="range"
                min={0}
                max={REASONING_LEVELS.length - 1}
                step={1}
                value={index}
                onChange={(event) => onChange(reasoningLevelFromIndex(Number(event.target.value)))}
                aria-label="模型思考强度"
                aria-valuetext={`${level.label}：${level.description}`}
                aria-describedby={descriptionId}
                className="reasoning-slider__input"
              />
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`思考强度：${level.label}`}
        title={helperText}
        className={cn(
          "reasoning-effort-trigger flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
          "border-hairline/40 bg-panel/70 text-ink-secondary hover:border-hairline hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
      >
        <BrainCircuit size={13} aria-hidden="true" />
        <span>{level.label}</span>
        {isMaximum && <span className="reasoning-effort-trigger__max-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
