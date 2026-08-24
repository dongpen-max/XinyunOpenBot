/** In-memory hand-off state for a bot's cloud computer. */
export interface ComputerControlSnapshot {
  held: boolean;
  helpReason: string | null;
  heldSinceMs: number | null;
  requestId?: string | null;
}

interface Entry {
  heldSinceMs: number | null;
  helpReason: string | null;
  requestId: string | null;
}

const EMPTY: ComputerControlSnapshot = { held: false, helpReason: null, heldSinceMs: null, requestId: null };
const MAX_REASON = 280;

export class ComputerControl {
  private readonly entries = new Map<string, Entry>();
  private sequence = 0;

  snapshot(botId: string): ComputerControlSnapshot {
    const entry = this.entries.get(botId);
    if (!entry) return EMPTY;
    return {
      held: entry.heldSinceMs !== null,
      helpReason: entry.helpReason,
      heldSinceMs: entry.heldSinceMs,
      requestId: entry.requestId,
    };
  }

  take(botId: string): ComputerControlSnapshot {
    const current = this.entries.get(botId);
    if (current?.heldSinceMs !== null && current?.heldSinceMs !== undefined) return this.snapshot(botId);
    this.entries.set(botId, {
      heldSinceMs: Date.now(),
      helpReason: current?.helpReason ?? null,
      requestId: current?.requestId ?? null,
    });
    return this.snapshot(botId);
  }

  release(botId: string): ComputerControlSnapshot {
    this.entries.delete(botId);
    return this.snapshot(botId);
  }

  requestHelp(botId: string, reason: unknown): ComputerControlSnapshot {
    const current = this.entries.get(botId) ?? { heldSinceMs: null, helpReason: null, requestId: null };
    if (!current.helpReason) {
      const text = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
      current.helpReason = text || "机器人请求你接管云电脑";
      current.requestId = `${botId}-${++this.sequence}`;
    }
    this.entries.set(botId, current);
    return this.snapshot(botId);
  }

  dismissHelp(botId: string): ComputerControlSnapshot {
    const current = this.entries.get(botId);
    if (!current) return EMPTY;
    current.helpReason = null;
    current.requestId = null;
    if (current.heldSinceMs === null) this.entries.delete(botId);
    return this.snapshot(botId);
  }

  expireHelp(botId: string, requestId: string): ComputerControlSnapshot {
    const current = this.entries.get(botId);
    if (!current || current.requestId !== requestId) return this.snapshot(botId);
    return this.dismissHelp(botId);
  }

  forget(botId: string): void {
    this.entries.delete(botId);
  }
}

export const COMPUTER_CONTROL_REFUSAL =
  "用户正在接管这台云电脑，本次操作未执行。不要重试；请等待用户交还控制权，然后重新截图再继续。";
