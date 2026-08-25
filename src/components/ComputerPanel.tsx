// The bot's computer, in the right-side slot. Where it runs decides the
// whole flow: cloud → provision the box on open (idempotent) and preview
// via SSE frames or a ~4s screenshot poll; local ("This Mac") → frames
// come from the Electron main process (desktopCapturer over the preload
// bridge — box endpoints are never touched); off → parked. Auto (unset)
// prefers the shared workspace cloud Box when configured, else local.
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Hand,
  Loader2,
  Monitor,
  Moon,
  Play,
  Power,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { cn } from "@/lib/cn";
import { zhCN } from "@/locales/zh-CN";
import { computerActivityLabel } from "@/lib/work-status";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

type Phase =
  | "checking"
  | "unconfigured"
  | "starting"
  | "ready"
  | "local"
  | "local-unavailable"
  | "off"
  | "error";

type Routine = {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number;
  lastRunAt?: number;
  lastStatus: "idle" | "queued" | "running" | "completed" | "failed";
  lastError?: string;
  runCount: number;
  history: Array<{ id: string; startedAt: number; finishedAt?: number; status: "queued" | "running" | "completed" | "failed"; error?: string }>;
};

export function ComputerPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [phase, setPhase] = useState<Phase>("checking");
  const [boxState, setBoxState] = useState<string | null>(null);
  const [lease, setLease] = useState<{ busy?: boolean; waiting: number; owner: { botId?: string; task?: string } | null } | null>(null);
  const [polledFrame, setPolledFrame] = useState<{ png: string; mime: string } | null>(null);
  const [localFrame, setLocalFrame] = useState<string | null>(null);
  const [pending, setPending] = useState<"join" | "sleep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const control = state.computerControl[bot.id] ?? { held: false, helpReason: null };
  const [controlPending, setControlPending] = useState(false);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineFormOpen, setRoutineFormOpen] = useState(false);
  const [routineName, setRoutineName] = useState("");
  const [routinePrompt, setRoutinePrompt] = useState("");
  const [routineInterval, setRoutineInterval] = useState("60");
  const [routinePending, setRoutinePending] = useState<string | null>(null);
  // bumped when a Box token is saved inline, to re-run the spin-up flow
  const [retry, setRetry] = useState(0);
  const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  const canWorkInCloud = engine?.capabilities?.computerTools === true;
  const localComputerLabel = window.ogb?.platform === "win32" ? zhCN.computer.thisComputer : zhCN.computer.thisMac;

  // resolve the mode on open; box endpoints are only ever hit on the
  // cloud path, so local/off can never render a JSON error as an image
  useEffect(() => {
    let alive = true;
    setPhase("checking");
    setPolledFrame(null);
    setLocalFrame(null);
    setError(null);
    const isElectron = Boolean(window.ogb);
    if (bot.computer === "off") {
      setPhase("off");
      return;
    }
    if (bot.computer === "local") {
      setPhase(isElectron ? "local" : "local-unavailable");
      return;
    }
    // cloud, or auto (a configured shared Box is provisioned/reused first)
    api(`/api/bots/${bot.id}/computer`)
      .then((status) => {
        if (!alive) return;
        const autoLocal = bot.computer !== "cloud" && isElectron;
        if (!status.configured) {
          setPhase(autoLocal ? "local" : "unconfigured");
          return;
        }
        setLease(status.lease ?? null);
        setPhase("starting");
        return api(`/api/bots/${bot.id}/computer/provision`, { method: "POST" }).then((r) => {
          if (!alive) return;
          setBoxState(r.state ?? null);
          setLease(r.lease ?? status.lease ?? null);
          setPhase("ready");
        });
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [bot.id, bot.computer, retry]);

  useEffect(() => {
    if (phase !== "ready") return;
    let alive = true;
    const refresh = () => void api(`/api/bots/${bot.id}/computer`).then((status) => {
      if (alive) setLease(status.lease ?? null);
    }).catch(() => {});
    const timer = setInterval(refresh, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [bot.id, phase]);

  useEffect(() => {
    let alive = true;
    api(`/api/bots/${bot.id}/computer/control`)
      .then((snapshot) => {
        if (!alive) return;
        dispatch({
          type: "computerControl",
          botId: bot.id,
          held: snapshot.held === true,
          helpReason: typeof snapshot.helpReason === "string" ? snapshot.helpReason : null,
          heldSinceMs: typeof snapshot.heldSinceMs === "number" ? snapshot.heldSinceMs : null,
          ownerBotId: typeof snapshot.ownerBotId === "string" ? snapshot.ownerBotId : null,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bot.id, dispatch]);

  useEffect(() => {
    let alive = true;
    const refreshRoutines = () => api(`/api/routines?botId=${encodeURIComponent(bot.id)}`)
      .then((body) => alive && setRoutines(Array.isArray(body.routines) ? body.routines : []))
      .catch(() => {});
    void refreshRoutines();
    const timer = setInterval(refreshRoutines, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [bot.id]);

  const controlAction = async (action: "take" | "release" | "dismiss-help") => {
    setControlPending(true);
    setError(null);
    try {
      const snapshot = await api(`/api/bots/${bot.id}/computer/control`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      dispatch({
        type: "computerControl",
        botId: bot.id,
        held: snapshot.held === true,
        helpReason: typeof snapshot.helpReason === "string" ? snapshot.helpReason : null,
        heldSinceMs: typeof snapshot.heldSinceMs === "number" ? snapshot.heldSinceMs : null,
        ownerBotId: typeof snapshot.ownerBotId === "string" ? snapshot.ownerBotId : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "云电脑控制权操作失败");
    } finally {
      setControlPending(false);
    }
  };

  const routineAction = async (routine: Routine, action: "toggle" | "run" | "delete") => {
    setRoutinePending(routine.id);
    setError(null);
    try {
      if (action === "delete") {
        await api(`/api/routines/${routine.id}`, { method: "DELETE" });
        setRoutines((items) => items.filter((item) => item.id !== routine.id));
      } else if (action === "toggle") {
        const { routine: updated } = await api(`/api/routines/${routine.id}`, {
          method: "PATCH", body: JSON.stringify({ enabled: !routine.enabled }),
        });
        setRoutines((items) => items.map((item) => item.id === routine.id ? updated : item));
      } else {
        const { routine: updated } = await api(`/api/routines/${routine.id}/run`, { method: "POST" });
        setRoutines((items) => items.map((item) => item.id === routine.id ? updated : item));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "例行任务操作失败");
    } finally {
      setRoutinePending(null);
    }
  };

  const createRoutine = async () => {
    const intervalMinutes = Number(routineInterval);
    if (!routineName.trim() || !routinePrompt.trim() || !Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
      setError("请填写任务名称、提示词和有效的间隔分钟数");
      return;
    }
    setRoutinePending("new");
    try {
      const { routine } = await api("/api/routines", {
        method: "POST",
        body: JSON.stringify({ botId: bot.id, name: routineName, prompt: routinePrompt, intervalMinutes: Math.trunc(intervalMinutes), enabled: true }),
      });
      setRoutines((items) => [routine, ...items]);
      setRoutineName(""); setRoutinePrompt(""); setRoutineInterval("60"); setRoutineFormOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建例行任务失败");
    } finally {
      setRoutinePending(null);
    }
  };

  // cloud preview: SSE frames win while the bot works; otherwise poll
  const live = state.screens[bot.id];
  const activity = state.computerActivity[bot.id];
  const activityLabel = computerActivityLabel(activity);
  const sseFlowing = Boolean(bot.busy && live);
  const inFlight = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || sseFlowing) return;
    let alive = true;
    const shoot = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const { png, format } = await api(`/api/bots/${bot.id}/computer/screenshot`, { method: "POST" });
        if (alive) setPolledFrame({ png, mime: format === "jpeg" ? "image/jpeg" : "image/png" });
      } catch {
        /* box mid-command or asleep — next tick */
      } finally {
        inFlight.current = false;
      }
    };
    void shoot();
    const timer = setInterval(shoot, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, sseFlowing, bot.id]);

  // local preview: frames from the Electron main process. The FIRST capture
  // attempt is what makes macOS show the Screen Recording prompt (there is
  // no reliable pre-grant flow on macOS 15+), so repeated empty frames mean
  // the user denied — surface the Settings repair path instead of spinning.
  const [localMisses, setLocalMisses] = useState(0);
  useEffect(() => {
    if (phase !== "local" || !window.ogb) return;
    let alive = true;
    setLocalMisses(0);
    const shoot = async () => {
      try {
        const url = await window.ogb!.screenFrame();
        if (alive && url) setLocalFrame(url);
        else if (alive) setLocalMisses((n) => n + 1);
      } catch {
        if (alive) setLocalMisses((n) => n + 1);
      }
    };
    void shoot();
    const timer = setInterval(shoot, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase]);

  const lastScreenMessage = [...bot.messages].reverse().find((m) => m.kind === "screen" && m.png);
  const cloudFrame =
    live ??
    polledFrame ??
    (lastScreenMessage ? { png: lastScreenMessage.png!, mime: lastScreenMessage.mime ?? "image/png" } : null);
  const frameSrc =
    phase === "local"
      ? localFrame
      : phase === "ready" || phase === "starting"
        ? cloudFrame && `data:${cloudFrame.mime};base64,${cloudFrame.png}`
        : null;

  const run = async (kind: "join" | "sleep") => {
    setPending(kind);
    setError(null);
    try {
      if (kind === "join") {
        if (!window.ogb?.cloudDesktop) throw new Error("云端桌面只能在 XinyunOpen Bot 桌面应用中打开");
        dispatch({ type: "openCloudDesktop", botId: bot.id });
        return;
      }
      // A sleeping Box invalidates its stream. Tear down the native view
      // before asking the server to archive the shared workspace computer.
      await window.ogb?.cloudDesktop?.close();
      dispatch({ type: "closeCloudDesktop" });
      await api(`/api/bots/${bot.id}/computer/sleep`, { method: "POST" });
      setBoxState("archived");
    } catch (e) {
      setError(e instanceof Error ? e.message : "云电脑操作失败，请稍后重试");
    } finally {
      setPending(null);
    }
  };

  const emptyState: Record<Exclude<Phase, "ready" | "local">, string> = {
    checking: zhCN.computer.phaseChecking,
    starting: zhCN.computer.phaseStarting,
    unconfigured: zhCN.computer.phaseUnconfigured,
    "local-unavailable": zhCN.computer.phaseLocalUnavailable,
    off: zhCN.computer.phaseOff,
    error: zhCN.computer.phaseError,
  };

  return (
    <aside className="animate-panel-in flex h-full w-full min-w-0 flex-col bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: true })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          title={zhCN.computer.botSettings}
        >
          <Settings size={18} />
        </button>
        <span className="text-[15px] font-semibold text-ink">{zhCN.computer.title}</span>
        <button
          onClick={() => dispatch({ type: "toggleComputer", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      {activityLabel && (
        <div className="mx-5 mb-1 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-[12px] text-ink-secondary" aria-live="polite">
          <Loader2 size={13} className="animate-spin text-accent" />
          <span>{activityLabel}</span>
          <span className="ml-auto text-[11px] text-ink-secondary/70">{bot.computer === "local" ? "本地运行" : "云端优先"}</span>
        </div>
      )}

      {lease && (lease.owner || lease.waiting > 0 || lease.busy === false) && (
        <div className="mx-5 mb-2 rounded-lg border border-hairline/30 bg-card px-3 py-2 text-[12px] text-ink-secondary" aria-live="polite">
          <div className="font-medium text-ink">
            {control.held
              ? control.ownerBotId
                ? `${state.bots.find((candidate) => candidate.id === control.ownerBotId)?.name ?? "其他 Bot"} 已暂停，等待人工操作`
                : "人工接管中"
              : lease.owner
                ? `当前占用：${lease.owner.botId === bot.id ? bot.name : "其他 Bot"}`
                : lease.waiting > 0
                  ? "排队中"
                  : "云电脑空闲"}
          </div>
          {lease.owner?.task && <div className="mt-0.5 truncate">任务：{lease.owner.task}</div>}
          {lease.waiting > 0 && <div className="mt-0.5">排队中：{lease.waiting} 个 Bot</div>}
        </div>
      )}

      {engine && !canWorkInCloud && (
        <div className="mx-5 mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-warning">
          {zhCN.settings.computerUnsupported}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Screen preview */}
        <div className="mb-1.5 mt-2 flex items-center justify-between text-[13px] text-ink-secondary">
          <span>{bot.name}{zhCN.computer.screenLabel}</span>
          {phase === "local" && <span className="text-[11px]">{localComputerLabel}</span>}
        </div>
        <div className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-xl bg-card">
          {frameSrc ? (
            <img src={frameSrc} alt={`${bot.name}${zhCN.computer.screenLabel}`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
              {phase === "checking" || phase === "starting" || phase === "local" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : phase === "off" ? (
                <Power size={22} />
              ) : (
                <Monitor size={22} />
              )}
              <span className="text-[12px]">
                {phase === "ready"
                  ? zhCN.computer.waitingFirstFrame
                  : phase === "local"
                    ? localMisses >= 3
                      ? zhCN.computer.noFramesPermission
                      : zhCN.computer.capturingScreen
                    : emptyState[phase]}
              </span>
              {phase === "local" && localMisses >= 3 && (
                <button
                  onClick={() => window.ogb?.permOpenSettings?.("screen")}
                  className="mt-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  {zhCN.computer.openSettings}
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
        {phase === "ready" && control.helpReason && !control.held && (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <div className="text-[13px] leading-relaxed text-warning">
              <b>{bot.name}</b> 请求你接管云电脑：{control.helpReason}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void controlAction("take")}
                disabled={controlPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                <Hand size={14} /> 接管操作
              </button>
              <button
                onClick={() => void controlAction("dismiss-help")}
                disabled={controlPending}
                className="rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
              >
                忽略
              </button>
            </div>
          </div>
        )}
        {phase === "ready" && control.held && (
          <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
            <div className="text-[13px] leading-relaxed text-ink">
              {control.ownerBotId
                ? `${state.bots.find((candidate) => candidate.id === control.ownerBotId)?.name ?? "其他 Bot"} 正在等待你的操作，机器人输入已暂停。`
                : "你正在操作云电脑，机器人点击和键盘输入已暂停。"}
            </div>
            <button
              onClick={() => void controlAction("release")}
              disabled={controlPending}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              <Hand size={14} /> 交还控制权
            </button>
          </div>
        )}
        {phase === "unconfigured" && (
          <div className="mt-3 rounded-xl bg-card p-4">
            <div className="mb-3 text-[13px] text-ink-secondary">
              {zhCN.computer.noBoxTokenDesc}
            </div>
            <ApiKeyRow
              section="box"
              label={zhCN.computer.boxToken}
              placeholder={zhCN.computer.boxTokenPlaceholder}
              onSaved={(configured) => configured && setRetry((n) => n + 1)}
            />
          </div>
        )}

        {/* Cloud-only actions */}
        {phase === "ready" && (
          <div className="mt-3 flex gap-2">
            {!control.held && !control.helpReason && (
              <button
                onClick={() => void controlAction("take")}
                disabled={controlPending}
                className="flex items-center justify-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                title="暂停机器人操作并接管云电脑"
              >
                <Hand size={14} /> 接管
              </button>
            )}
            <button
              onClick={() => void run("join")}
              disabled={pending === "join"}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              {pending === "join" ? <Loader2 size={14} className="animate-spin" /> : <Monitor size={14} />}
              {zhCN.computer.openDesktop}
            </button>
            {boxState !== "archived" && (
              <button
                onClick={() => void run("sleep")}
                disabled={pending === "sleep"}
                className="flex items-center justify-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                title={zhCN.computer.sleepTitle}
              >
                {pending === "sleep" ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
                {zhCN.computer.sleep}
              </button>
            )}
          </div>
        )}

        {/* Computer source */}
        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">{zhCN.computer.runsOn}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {bot.computer ? "" : zhCN.computer.runsOnAutoPrefix + " "}{zhCN.computer.runsOnDesc}
          </div>
          <div className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary/80">{zhCN.computer.sharedPrimary}</div>
          <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
            {(
              [
                ["cloud", zhCN.computer.cloudBox],
                ["local", localComputerLabel],
                ["off", zhCN.computer.offBox],
              ] as const
            ).map(([mode, label], i) => (
              <button
                key={mode}
                onClick={() => dispatch({ type: "updateBot", botId: bot.id, patch: { computer: mode } })}
                className={cn(
                  "flex-1 py-1.5 text-[13px]",
                  i > 0 && "border-l border-hairline/40",
                  bot.computer === mode
                    ? "bg-raised text-ink"
                    : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Routines */}
        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <CalendarClock size={16} className="text-ink-secondary" />
            {zhCN.computer.routines}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {zhCN.computer.routinesDesc}
          </div>
          <div className="mt-3 space-y-2">
            {routines.map((routine) => (
              <div key={routine.id} className="rounded-lg border border-hairline/40 bg-panel/60 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{routine.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-secondary">每 {routine.intervalMinutes} 分钟 · {routine.lastStatus === "running" ? "运行中" : routine.lastStatus === "completed" ? "已完成" : routine.lastStatus === "failed" ? "失败" : "待运行"}</div>
                  </div>
                  <button onClick={() => void routineAction(routine, "toggle")} disabled={routinePending === routine.id} className={cn("rounded-md px-2 py-1 text-[11px]", routine.enabled ? "bg-accent/15 text-accent" : "bg-raised text-ink-secondary")}>
                    {routine.enabled ? "已启用" : "已停用"}
                  </button>
                </div>
                {routine.lastError && <div className="mt-2 line-clamp-2 text-[11px] text-danger">{routine.lastError}</div>}
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => void routineAction(routine, "run")} disabled={routinePending === routine.id || routine.lastStatus === "running"} className="flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-[11px] text-ink hover:bg-raised-hover disabled:opacity-50"><Play size={11} />立即运行</button>
                  <button onClick={() => void routineAction(routine, "delete")} disabled={routinePending === routine.id} className="ml-auto rounded-md p-1 text-ink-secondary hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
          {routineFormOpen ? (
            <div className="mt-3 space-y-2 rounded-lg border border-hairline/40 bg-panel/50 p-3">
              <input value={routineName} onChange={(e) => setRoutineName(e.target.value)} placeholder="任务名称" className="w-full rounded-md bg-raised px-2.5 py-2 text-[12px] text-ink outline-none" />
              <textarea value={routinePrompt} onChange={(e) => setRoutinePrompt(e.target.value)} placeholder="例如：检查今天的项目进展并总结重点" rows={3} className="w-full resize-none rounded-md bg-raised px-2.5 py-2 text-[12px] text-ink outline-none" />
              <div className="flex items-center gap-2"><span className="text-[12px] text-ink-secondary">每</span><input value={routineInterval} onChange={(e) => setRoutineInterval(e.target.value)} inputMode="numeric" className="w-16 rounded-md bg-raised px-2 py-1.5 text-[12px] text-ink outline-none" /><span className="text-[12px] text-ink-secondary">分钟运行</span></div>
              <div className="flex gap-2"><button onClick={() => setRoutineFormOpen(false)} className="flex-1 rounded-md bg-raised py-1.5 text-[12px] text-ink-secondary">取消</button><button onClick={() => void createRoutine()} disabled={routinePending === "new"} className="flex-1 rounded-md bg-accent py-1.5 text-[12px] text-white disabled:opacity-50">保存</button></div>
            </div>
          ) : (
            <button onClick={() => setRoutineFormOpen(true)} className="mt-3 w-full rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover">{zhCN.computer.createRoutine}</button>
          )}
        </div>
      </div>
    </aside>
  );
}
