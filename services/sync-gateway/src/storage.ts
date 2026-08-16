import type { DeviceType, SyncCommand, SyncEvent } from "@xinyun/contracts";

export interface DeviceRecord {
  workspaceId: string;
  deviceId: string;
  deviceType: DeviceType;
  name: string;
  tokenHash: string;
  createdAt: number;
  revokedAt?: number;
  pushToken?: string;
}

export interface PairingRecord {
  pairingId: string;
  code: string;
  workspaceId: string;
  desktopDeviceId: string;
  expiresAt: number;
  claimedAt?: number;
}

export interface StoredCommand {
  workspaceId: string;
  command: SyncCommand;
  createdAt: number;
  completedAt?: number;
  accepted?: boolean;
  error?: string;
}

export interface GatewayStorage {
  createPairing(pairing: PairingRecord, desktop: DeviceRecord): void;
  pairingByCode(code: string): PairingRecord | undefined;
  claimPairing(pairingId: string, mobile: DeviceRecord, claimedAt: number): boolean;
  device(workspaceId: string, deviceId: string): DeviceRecord | undefined;
  savePushToken(workspaceId: string, deviceId: string, pushToken: string): boolean;
  pushTokens(workspaceId: string): string[];
  revokeDevice(workspaceId: string, deviceId: string, revokedAt: number): boolean;
  appendEvent(event: Omit<SyncEvent, "sequence">): SyncEvent;
  eventsAfter(workspaceId: string, sequence: number, limit?: number): SyncEvent[];
  latestSequence(workspaceId: string): number;
  latestSnapshot(workspaceId: string): SyncEvent | undefined;
  insertCommand(workspaceId: string, command: SyncCommand, createdAt: number): boolean;
  pendingCommands(workspaceId: string): StoredCommand[];
  completeCommand(workspaceId: string, clientMutationId: string, accepted: boolean, error?: string): boolean;
  close(): void;
}
