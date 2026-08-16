import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import type { CloudDesktopBounds, CloudDesktopState } from "@/types/ogb";

const labels: Record<CloudDesktopState["state"], string> = {
  connecting: "正在连接",
  ready: "已连接",
  reconnecting: "正在重新连接",
  failed: "连接失败",
  closed: "已关闭",
};

function sameBounds(a: CloudDesktopBounds | null, b: CloudDesktopBounds) {
  return Boolean(
    a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height,
  );
}

export function CloudDesktopView({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const bridge = window.ogb?.cloudDesktop;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [desktop, setDesktop] = useState<CloudDesktopState>({
    state: "connecting",
    botId: bot.id,
    fullscreen: false,
  });
  const [sleeping, setSleeping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isWin = window.ogb?.platform === "win32";
  const drag = isWin ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDrag = isWin ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;

  useEffect(() => {
    if (!bridge) {
      setDesktop({
        state: "failed",
        botId: bot.id,
        fullscreen: false,
        message: "云端桌面只能在 XinyunOpen Bot 桌面应用中打开",
      });
      return;
    }

    let alive = true;
    const unsubscribe = bridge.onState((next) => {
      if (alive && (!next.botId || next.botId === bot.id)) setDesktop(next);
    });
    void bridge.open(bot.id).then((result) => {
      if (alive && !result.ok) {
        setDesktop((current) =>
          current.state === "failed"
            ? current
            : { ...current, state: "failed", message: "云端桌面连接失败，请重新连接" },
        );
      }
    });

    const closeOnUnload = () => void bridge.close();
    window.addEventListener("beforeunload", closeOnUnload);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener("beforeunload", closeOnUnload);
      void bridge.close();
    };
  }, [bot.id, bridge]);

  useEffect(() => {
    if (!bridge) return;
    let frame = 0;
    let stopped = false;
    let previous: CloudDesktopBounds | null = null;
    const sync = () => {
      if (stopped) return;
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const next = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        if (!sameBounds(previous, next)) {
          previous = next;
          void bridge.setBounds(next).catch(() => {});
        }
      }
      frame = requestAnimationFrame(sync);
    };
    frame = requestAnimationFrame(sync);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [bridge]);

  const closeDesktop = useCallback(async () => {
    try {
      await bridge?.close();
    } finally {
      dispatch({ type: "closeCloudDesktop" });
    }
  }, [bridge, dispatch]);

  const reconnect = async () => {
    if (!bridge) return;
    setActionError(null);
    const result = await bridge.reconnect(bot.id);
    if (!result.ok) setActionError("重新连接失败，请稍后再试");
  };

  const reload = async () => {
    setActionError(null);
    try {
      await bridge?.reload();
    } catch {
      setActionError("刷新云端桌面失败，请重新连接");
    }
  };

  const toggleFullscreen = async () => {
    try {
      await bridge?.toggleFullscreen();
    } catch {
      setActionError("切换全屏失败");
    }
  };

  const sleep = async () => {
    if (sleeping) return;
    setSleeping(true);
    setActionError(null);
    try {
      await bridge?.close();
      const response = await fetch(`/api/bots/${bot.id}/computer/sleep`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) throw new Error();
      dispatch({ type: "closeCloudDesktop" });
    } catch {
      setActionError("休眠云电脑失败，请稍后重试");
    } finally {
      setSleeping(false);
    }
  };

  const busy = desktop.state === "connecting" || desktop.state === "reconnecting";
  const failedMessage = actionError ?? (desktop.state === "failed" ? desktop.message : null);

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <div
        className={cn(
          "flex min-h-[46px] items-center gap-2 border-b border-hairline/40 bg-panel px-3",
          isWin && "pr-[148px]",
        )}
        style={drag}
      >
        <button
          onClick={() => void closeDesktop()}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
          style={noDrag}
        >
          <ChevronLeft size={15} /> 返回聊天
        </button>
        <div className="mx-1 h-5 w-px bg-hairline/50" />
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-ink" aria-live="polite">
          <span
            className={cn(
              "size-2 rounded-full",
              desktop.state === "ready"
                ? "bg-success"
                : desktop.state === "failed"
                  ? "bg-danger"
                  : "bg-warning",
            )}
          />
          <span className="truncate">{bot.name} · {labels[desktop.state]}</span>
        </div>
        <div className="ml-auto flex items-center gap-1" style={noDrag}>
          <button
            onClick={() => void reconnect()}
            disabled={!bridge || busy || sleeping}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="获取新连接并重新连接"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => void reload()}
            disabled={!bridge || busy || sleeping || desktop.state === "failed"}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="刷新当前桌面页面"
          >
            <RotateCw size={15} />
          </button>
          <button
            onClick={() => void toggleFullscreen()}
            disabled={!bridge || sleeping}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title={desktop.fullscreen ? "退出全屏" : "全屏"}
          >
            {desktop.fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            onClick={() => void sleep()}
            disabled={!bridge || sleeping}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="先关闭内嵌桌面，再休眠云电脑"
          >
            {sleeping ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
            休眠
          </button>
          <button
            onClick={() => void closeDesktop()}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            title="关闭桌面"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div ref={surfaceRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#05080d]">
        {(busy || sleeping) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-secondary">
            <Loader2 size={22} className="animate-spin" />
            <span className="text-[13px]">{sleeping ? "正在休眠云电脑…" : labels[desktop.state]}</span>
          </div>
        )}
        {failedMessage && !sleeping && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md rounded-xl border border-danger/30 bg-danger/10 px-5 py-4 text-center">
              <div className="text-[14px] font-medium text-danger">{failedMessage}</div>
              <button
                onClick={() => void reconnect()}
                disabled={!bridge}
                className="mt-3 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
              >
                重新连接
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
