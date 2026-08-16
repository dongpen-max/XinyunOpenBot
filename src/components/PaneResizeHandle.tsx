import { useRef } from "react";
import { cn } from "@/lib/cn";

export function PaneResizeHandle({
  label,
  value,
  min,
  max,
  direction = 1,
  onResize,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: 1 | -1;
  onResize: (delta: number) => void;
  onReset: () => void;
}) {
  const lastX = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        lastX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastX.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = (event.clientX - lastX.current) * direction;
        lastX.current = event.clientX;
        if (delta) onResize(delta);
      }}
      onPointerUp={(event) => {
        lastX.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        lastX.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 12;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onResize(-step * direction);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onResize(step * direction);
        } else if (event.key === "Home") {
          event.preventDefault();
          onResize((min - value));
        } else if (event.key === "End") {
          event.preventDefault();
          onResize((max - value));
        }
      }}
      className={cn(
        "group relative z-20 h-full w-[7px] shrink-0 cursor-col-resize touch-none outline-none",
        "bg-app hover:bg-accent/10 focus-visible:bg-accent/10",
      )}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title={`${label}（拖动调整，双击重置）`}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hairline/55 transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  );
}
