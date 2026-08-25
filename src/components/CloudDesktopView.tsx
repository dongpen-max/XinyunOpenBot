import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  ClipboardPaste,
  ExternalLink,
  Hand,
  Keyboard,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { syncWindowTitleBarColor } from "@/lib/theme";
import type { CloudDesktopBounds, CloudDesktopState } from "@/types/ogb";

const labels: Record<CloudDesktopState["state"], string> = {
  connecting: "正在连接",
  ready: "已连接",
  reconnecting: "可恢复 · 正在重连",
  failed: "已失败",
  closed: "连接断开",
};

function sameBounds(a: CloudDesktopBounds | null, b: CloudDesktopBounds) {
  return Boolean(
    a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height,
  );
}

export function CloudDesktopView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const bridge = window.ogb?.cloudDesktop;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [desktop, setDesktop] = useState<CloudDesktopState>({
    state: "connecting",
    botId: bot.id,
    fullscreen: false,
  });
  const [sleeping, setSleeping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const control = state.computerControl[bot.id] ?? { held: false, helpReason: null };
  const [controlPending, setControlPending] = useState(false);
  const releaseControl = useCallback(() => {
    void fetch(`/api/bots/${bot.id}/computer/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "release" }),
      keepalive: true,
    }).catch(() => {});
  }, [bot.id]);
  const noDrag = window.ogb?.platform === "win32"
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  useEffect(() => {
    syncWindowTitleBarColor("panel");
    return () => syncWindowTitleBarColor("app");
  }, []);

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
      if (alive && (!next.botId || next.botId === bot.id)) {
        setDesktop(next);
        // A dropped noVNC/native bridge must not strand a server-side human
        // lease. Releasing is idempotent and the server remains authoritative.
        if (next.state === "failed" || next.state === "closed") {
          releaseControl();
        }
      }
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
      releaseControl();
      void bridge.close();
    };
  }, [bot.id, bridge, releaseControl]);

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
      releaseControl();
      dispatch({ type: "closeCloudDesktop" });
    }
  }, [bridge, dispatch, releaseControl]);

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

  const focusDesktop = async () => {
    setActionError(null);
    try {
      const focused = await bridge?.focus();
      if (!focused) setActionError("云端桌面尚未就绪，请稍后重试");
    } catch {
      setActionError("无法获取云端桌面的键盘焦点");
    }
  };

  const pasteDesktop = async () => {
    setActionError(null);
    try {
      const pasted = await bridge?.paste();
      if (!pasted) setActionError("云端桌面尚未就绪，请稍后重试");
    } catch {
      setActionError("粘贴失败，请先重新获取键盘焦点后再试");
    }
  };

  const openInBrowser = async () => {
    if (!bridge) return;
    setActionError(null);
    try {
      const result = await bridge.openInBrowser(bot.id);
      if (!result.ok) throw new Error();
      await bridge.close();
      releaseControl();
      dispatch({ type: "closeCloudDesktop" });
    } catch {
      setActionError("无法在默认浏览器中打开云端桌面");
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
      releaseControl();
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

  const controlAction = async (action: "take" | "release" | "dismiss-help") => {
    setControlPending(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/bots/${bot.id}/computer/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const snapshot = await response.json().catch(() => null);
      if (!response.ok) throw new Error(snapshot?.error ?? "云电脑控制权操作失败");
      dispatch({
        type: "computerControl",
        botId: bot.id,
        held: snapshot?.held === true,
        helpReason: typeof snapshot?.helpReason === "string" ? snapshot.helpReason : null,
        heldSinceMs: typeof snapshot?.heldSinceMs === "number" ? snapshot.heldSinceMs : null,
        ownerBotId: typeof snapshot?.ownerBotId === "string" ? snapshot.ownerBotId : null,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "云电脑控制权操作失败");
    } finally {
      setControlPending(false);
    }
  };

  const busy = desktop.state === "connecting" || desktop.state === "reconnecting";
  const failedMessage = actionError ?? (desktop.state === "failed" ? desktop.message : null);

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-[46px] z-[80] bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`${bot.name}的云端桌面`}
    >
      <aside
        className={cn(
          "absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-hairline/70 bg-app",
          "inset-x-[clamp(24px,4.5vw,92px)] bottom-[clamp(24px,4vh,48px)] top-[clamp(24px,3.5vh,36px)]",
          "shadow-[0_28px_90px_rgba(0,0,0,0.62)]",
        )}
      >
        <div
          className="flex min-h-12 shrink-0 items-center gap-3 border-b border-hairline/40 bg-panel px-3"
          style={noDrag}
        >
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-ink" aria-live="polite">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                desktop.state === "ready"
                  ? "bg-success"
                  : desktop.state === "failed"
                    ? "bg-danger"
                    : "bg-warning",
              )}
            />
            <span className="truncate font-medium">{bot.name}</span>
            <span className="hidden shrink-0 text-ink-secondary sm:inline">· {labels[desktop.state]}</span>
          </div>
          <span className="hidden min-w-0 truncate text-[11.5px] text-ink-secondary md:block">云端桌面</span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => void openInBrowser()}
            disabled={!bridge || sleeping}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="在默认浏览器中打开（支持完整键盘和剪贴板）"
            aria-label="在默认浏览器中打开云端桌面"
          >
            <ExternalLink size={15} />
          </button>
          <button
            onClick={() => void focusDesktop()}
            disabled={!bridge || busy || sleeping || desktop.state !== "ready"}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="重新获取键盘焦点"
            aria-label="重新获取键盘焦点"
          >
            <Keyboard size={15} />
          </button>
          <button
            onClick={() => void pasteDesktop()}
            disabled={!bridge || busy || sleeping || desktop.state !== "ready"}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="粘贴本机剪贴板"
            aria-label="粘贴本机剪贴板"
          >
            <ClipboardPaste size={15} />
          </button>
          <button
            onClick={() => void reconnect()}
            disabled={!bridge || busy || sleeping}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="获取新连接并重新连接"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => void reload()}
            disabled={!bridge || busy || sleeping || desktop.state === "failed"}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="刷新当前桌面页面"
          >
            <RotateCw size={15} />
          </button>
          <button
            onClick={() => void toggleFullscreen()}
            disabled={!bridge || sleeping}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title={desktop.fullscreen ? "退出全屏" : "全屏"}
          >
            {desktop.fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            onClick={() => void sleep()}
            disabled={!bridge || sleeping}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
            title="先关闭内嵌桌面，再休眠云电脑"
          >
            {sleeping ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
          </button>
          <button
            onClick={() => void closeDesktop()}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            title="关闭桌面"
          >
            <X size={16} />
          </button>
        </div>
        </div>

        <div
          ref={surfaceRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-[#05080d]"
          onMouseDown={() => void bridge?.focus()}
        >
          {(control.helpReason || control.held) && (
            <div className="absolute left-3 right-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-accent/30 bg-[#101722]/95 px-3 py-2 text-[12px] text-white shadow-lg">
              <Hand size={14} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">
                {controlPending
                  ? control.held
                    ? "释放中：正在交还控制权…"
                    : "正在接管云电脑…"
                  : control.held
                  ? control.ownerBotId
                    ? `${state.bots.find((candidate) => candidate.id === control.ownerBotId)?.name ?? "其他 Bot"} 正在等待你的操作，机器人输入已暂停`
                    : "你正在接管云电脑，机器人操作已暂停"
                  : `机器人请求接管：${control.helpReason}`}
              </span>
              {control.held ? (
                <button
                  onClick={() => void controlAction("release")}
                  disabled={controlPending}
                  className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  交还控制权
                </button>
              ) : (
                <button
                  onClick={() => void controlAction("take")}
                  disabled={controlPending}
                  className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  接管
                </button>
              )}
            </div>
          )}
          {(busy || sleeping) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-secondary">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-[13px]">{sleeping ? "释放中：正在关闭云电脑…" : labels[desktop.state]}</span>
            </div>
          )}
          {failedMessage && !sleeping && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="max-w-md rounded-xl border border-danger/30 bg-danger/10 px-5 py-4 text-center">
                <div className="text-[14px] font-medium text-danger">{failedMessage}</div>
                <div className="mt-1 text-[12px] text-ink-secondary">连接状态：已失败，可恢复</div>
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
          {desktop.state === "ready" && !sleeping && !failedMessage && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-[11.5px] text-white/80 shadow-sm">
              输入异常时，点击上方↗按钮可在浏览器中获得完整键盘和剪贴板支持
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
