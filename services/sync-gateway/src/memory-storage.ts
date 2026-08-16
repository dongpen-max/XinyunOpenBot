import type { SyncEvent } from "@xinyun/contracts";
import type { DeviceRecord, GatewayStorage, PairingRecord, StoredCommand } from "./storage.ts";

export class MemoryGatewayStorage implements GatewayStorage {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly events = new Map<string, SyncEvent[]>();
  private readonly commands = new Map<string, StoredCommand>();

  private deviceKey(workspaceId: string, deviceId: string) { return `${workspaceId}:${deviceId}`; }
  private commandKey(workspaceId: string, mutationId: string) { return `${workspaceId}:${mutationId}`; }

  createPairing(pairing: PairingRecord, desktop: DeviceRecord): void {
    this.pairings.set(pairing.pairingId, { ...pairing });
    this.devices.set(this.deviceKey(desktop.workspaceId, desktop.deviceId), { ...desktop });
  }

  pairingByCode(code: string): PairingRecord | undefined {
    return [...this.pairings.values()].find((pairing) => pairing.code === code);
  }

  claimPairing(pairingId: string, mobile: DeviceRecord, claimedAt: number): boolean {
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.claimedAt || pairing.expiresAt < claimedAt) return false;
    pairing.claimedAt = claimedAt;
    this.devices.set(this.deviceKey(mobile.workspaceId, mobile.deviceId), { ...mobile });
    return true;
  }

  device(workspaceId: string, deviceId: string): DeviceRecord | undefined {
    const record = this.devices.get(this.deviceKey(workspaceId, deviceId));
    return record ? { ...record } : undefined;
  }

  savePushToken(workspaceId: string, deviceId: string, pushToken: string): boolean {
    const record = this.devices.get(this.deviceKey(workspaceId, deviceId));
    if (!record || record.revokedAt) return false;
    record.pushToken = pushToken;
    return true;
  }

  pushTokens(workspaceId: string): string[] {
    return [...this.devices.values()].filter((device) => device.workspaceId === workspaceId && !device.revokedAt && device.pushToken).map((device) => device.pushToken!);
  }

  revokeDevice(workspaceId: string, deviceId: string, revokedAt: number): boolean {
    const record = this.devices.get(this.deviceKey(workspaceId, deviceId));
    if (!record) return false;
    record.revokedAt = revokedAt;
    return true;
  }

  appendEvent(event: Omit<SyncEvent, "sequence">): SyncEvent {
    const list = this.events.get(event.workspaceId) ?? [];
    const saved = { ...event, sequence: (list.at(-1)?.sequence ?? 0) + 1 } as SyncEvent;
    list.push(saved);
    this.events.set(event.workspaceId, list);
    return saved;
  }

  eventsAfter(workspaceId: string, sequence: number, limit = 2_000): SyncEvent[] {
    return (this.events.get(workspaceId) ?? []).filter((event) => event.sequence > sequence).slice(0, limit);
  }

  latestSequence(workspaceId: string): number { return this.events.get(workspaceId)?.at(-1)?.sequence ?? 0; }

  latestSnapshot(workspaceId: string): SyncEvent | undefined {
    return [...(this.events.get(workspaceId) ?? [])].reverse().find((event) => event.type === "snapshot");
  }

  insertCommand(workspaceId: string, command: StoredCommand["command"], createdAt: number): boolean {
    const key = this.commandKey(workspaceId, command.clientMutationId);
    if (this.commands.has(key)) return false;
    this.commands.set(key, { workspaceId, command, createdAt });
    return true;
  }

  pendingCommands(workspaceId: string): StoredCommand[] {
    return [...this.commands.values()].filter((entry) => entry.workspaceId === workspaceId && !entry.completedAt);
  }

  completeCommand(workspaceId: string, clientMutationId: string, accepted: boolean, error?: string): boolean {
    const command = this.commands.get(this.commandKey(workspaceId, clientMutationId));
    if (!command) return false;
    command.completedAt = Date.now();
    command.accepted = accepted;
    command.error = error;
    return true;
  }

  close(): void {}
}
