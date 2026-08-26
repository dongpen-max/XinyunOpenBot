/** In-memory hand-off state for a bot's cloud computer. */
export interface ComputerControlSnapshot {
  held: boolean;
  helpReason: string | null;
  heldSinceMs: number | null;
  requestId?: string | null;
  expiresAtMs?: number | null;
  ownerBotId?: string | null;
}

interface Entry {
  heldSinceMs: number | null;
  helpReason: string | null;
  requestId: string | null;
  expiresAtMs: number | null;
}

const EMPTY: ComputerControlSnapshot = { held: false, helpReason: null, heldSinceMs: null, requestId: null, expiresAtMs: null };
const MAX_REASON = 280;
const DEFAULT_TAKEOVER_TIMEOUT_MS = 15 * 60_000;

export class ComputerControl {
  private readonly entries = new Map<string, Entry>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private sequence = 0;
  private readonly onChange?: (botId: string, snapshot: ComputerControlSnapshot) => void;
  constructor(onChange?: (botId: string, snapshot: ComputerControlSnapshot) => void) {
    this.onChange = onChange;
  }

  snapshot(botId: string): ComputerControlSnapshot {
    const entry = this.entries.get(botId);
    if (!entry) return EMPTY;
    return {
      held: entry.heldSinceMs !== null,
      helpReason: entry.helpReason,
      heldSinceMs: entry.heldSinceMs,
      requestId: entry.requestId,
      expiresAtMs: entry.expiresAtMs,
    };
  }

  take(botId: string, timeoutMs = DEFAULT_TAKEOVER_TIMEOUT_MS): ComputerControlSnapshot {
    const current = this.entries.get(botId);
    if (current?.heldSinceMs !== null && current?.heldSinceMs !== undefined) return this.snapshot(botId);
    this.entries.set(botId, {
      heldSinceMs: Date.now(),
      helpReason: current?.helpReason ?? null,
      requestId: current?.requestId ?? null,
      expiresAtMs: Date.now() + timeoutMs,
    });
    const timer = setTimeout(() => {
      const entry = this.entries.get(botId);
      if (entry?.heldSinceMs !== null && entry?.expiresAtMs && entry.expiresAtMs <= Date.now()) {
        this.release(botId);
      }
    }, timeoutMs);
    timer.unref?.();
    this.timers.set(botId, timer);
    const snapshot = this.snapshot(botId);
    this.onChange?.(botId, snapshot);
    return snapshot;
  }

  release(botId: string): ComputerControlSnapshot {
    const timer = this.timers.get(botId);
    if (timer) clearTimeout(timer);
    this.timers.delete(botId);
    this.entries.delete(botId);
    const snapshot = this.snapshot(botId);
    this.onChange?.(botId, snapshot);
    return snapshot;
  }

  requestHelp(botId: string, reason: unknown): ComputerControlSnapshot {
    const current = this.entries.get(botId) ?? { heldSinceMs: null, helpReason: null, requestId: null, expiresAtMs: null };
    if (!current.helpReason) {
      const text = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
      current.helpReason = text || "机器人请求你接管云电脑";
      current.requestId = `${botId}-${++this.sequence}`;
    }
    this.entries.set(botId, current);
    const snapshot = this.snapshot(botId);
    this.onChange?.(botId, snapshot);
    return snapshot;
  }

  dismissHelp(botId: string): ComputerControlSnapshot {
    const current = this.entries.get(botId);
    if (!current) return EMPTY;
    current.helpReason = null;
    current.requestId = null;
    if (current.heldSinceMs === null) this.entries.delete(botId);
    const snapshot = this.snapshot(botId);
    this.onChange?.(botId, snapshot);
    return snapshot;
  }

  expireHelp(botId: string, requestId: string): ComputerControlSnapshot {
    const current = this.entries.get(botId);
    if (!current || current.requestId !== requestId) return this.snapshot(botId);
    return this.dismissHelp(botId);
  }

  forget(botId: string): void {
    const timer = this.timers.get(botId);
    if (timer) clearTimeout(timer);
    this.timers.delete(botId);
    this.entries.delete(botId);
  }
}

export const COMPUTER_CONTROL_REFUSAL =
  "用户正在接管这台云电脑，本次操作未执行。不要重试；请等待用户交还控制权，然后重新截图再继续。";

/** Shared server/proxy gate: model switches never bypass a human lease. */
export function computerControlRefusal(snapshot: Pick<ComputerControlSnapshot, "held">): string | null {
  return snapshot.held ? COMPUTER_CONTROL_REFUSAL : null;
}
