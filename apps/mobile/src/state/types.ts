import type { BotSummary, GroupSummary, MobileMessage } from "@xinyun/contracts";
import type { SyncConnectionState } from "@xinyun/sync-client";

export interface MobileCache {
  sequence: number;
  bots: BotSummary[];
  groups: GroupSummary[];
  messagesByThread: Record<string, MobileMessage[]>;
}

export interface MobileState extends MobileCache {
  hydrated: boolean;
  paired: boolean;
  connection: SyncConnectionState;
  networkAvailable: boolean;
  streamingByThread: Record<string, string>;
  activeThreadId: string | null;
  lastError: string | null;
}
