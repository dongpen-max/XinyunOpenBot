import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export function PaneResizeHandle({
  label,
  value,
  min,
  max,
  direction = 1,
  onResizePreview,
  onResize,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: 1 | -1;
  onResizePreview: (value: number) => void;
  onResize: (delta: number) => void;
  onReset: () => void;
}) {
  const stopDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopDragRef.current?.(), []);

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
        if (event.button !== 0 || stopDragRef.current) return;
        event.preventDefault();

        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startValue = value;
        const upperBound = Math.max(min, max);
        let currentValue = startValue;
        let finished = false;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;

        const valueAt = (clientX: number) => {
          const requested = startValue + (clientX - startX) * direction;
          return Math.min(Math.max(requested, min), upperBound);
        };

        const previewAt = (clientX: number) => {
          const nextValue = valueAt(clientX);
          if (nextValue === currentValue) return;
          currentValue = nextValue;
          onResizePreview(nextValue);
        };

        const onPointerMove = (pointerEvent: PointerEvent) => {
          if (pointerEvent.pointerId !== pointerId) return;
          previewAt(pointerEvent.clientX);
        };

        const finishDrag = (clientX?: number) => {
          if (finished) return;
          if (clientX !== undefined) previewAt(clientX);
          finished = true;
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerCancel);
          window.removeEventListener("blur", onWindowBlur);
          window.removeEventListener("keydown", onWindowKeyDown);
          handle.removeEventListener("lostpointercapture", onLostPointerCapture);
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          document.body.style.cursor = previousCursor;
          document.body.style.userSelect = previousUserSelect;
          delete document.documentElement.dataset.paneResizing;
          stopDragRef.current = null;
          const delta = currentValue - startValue;
          if (delta) onResize(delta);
        };

        const onPointerUp = (pointerEvent: PointerEvent) => {
          if (pointerEvent.pointerId === pointerId) finishDrag(pointerEvent.clientX);
        };
        const onPointerCancel = (pointerEvent: PointerEvent) => {
          if (pointerEvent.pointerId === pointerId) finishDrag(pointerEvent.clientX);
        };
        const onWindowBlur = () => finishDrag();
        const onWindowKeyDown = (keyboardEvent: KeyboardEvent) => {
          if (keyboardEvent.key === "Escape") finishDrag();
        };
        const onLostPointerCapture = () => finishDrag();

        stopDragRef.current = () => finishDrag();
        document.documentElement.dataset.paneResizing = "true";
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        handle.setPointerCapture(pointerId);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("keydown", onWindowKeyDown);
        handle.addEventListener("lostpointercapture", onLostPointerCapture);
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
          onResize(min - value);
        } else if (event.key === "End") {
          event.preventDefault();
          onResize(max - value);
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
