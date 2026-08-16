import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SyncCommand, SyncEvent } from "@xinyun/contracts";
import type { DeviceRecord, GatewayStorage, PairingRecord, StoredCommand } from "./storage.ts";

export class SqliteGatewayStorage implements GatewayStorage {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS devices (
        workspace_id TEXT NOT NULL, device_id TEXT NOT NULL, device_type TEXT NOT NULL,
        name TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        revoked_at INTEGER, push_token TEXT, PRIMARY KEY(workspace_id, device_id)
      );
      CREATE TABLE IF NOT EXISTS pairings (
        pairing_id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, workspace_id TEXT NOT NULL,
        desktop_device_id TEXT NOT NULL, expires_at INTEGER NOT NULL, claimed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS workspace_sequences (workspace_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        workspace_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_id TEXT NOT NULL,
        type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, sequence), UNIQUE(workspace_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS events_workspace_type ON events(workspace_id, type, sequence DESC);
      CREATE TABLE IF NOT EXISTS commands (
        workspace_id TEXT NOT NULL, client_mutation_id TEXT NOT NULL, command TEXT NOT NULL,
        created_at INTEGER NOT NULL, completed_at INTEGER, accepted INTEGER, error TEXT,
        PRIMARY KEY(workspace_id, client_mutation_id)
      );
    `);
  }

  createPairing(pairing: PairingRecord, desktop: DeviceRecord): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO pairings VALUES (?, ?, ?, ?, ?, NULL)").run(pairing.pairingId, pairing.code, pairing.workspaceId, pairing.desktopDeviceId, pairing.expiresAt);
      this.db.prepare("INSERT INTO devices(workspace_id,device_id,device_type,name,token_hash,created_at) VALUES(?,?,?,?,?,?)")
        .run(desktop.workspaceId, desktop.deviceId, desktop.deviceType, desktop.name, desktop.tokenHash, desktop.createdAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  pairingByCode(code: string): PairingRecord | undefined {
    const row = this.db.prepare("SELECT * FROM pairings WHERE code=?").get(code) as any;
    return row ? { pairingId: row.pairing_id, code: row.code, workspaceId: row.workspace_id, desktopDeviceId: row.desktop_device_id, expiresAt: row.expires_at, claimedAt: row.claimed_at ?? undefined } : undefined;
  }

  claimPairing(pairingId: string, mobile: DeviceRecord, claimedAt: number): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("UPDATE pairings SET claimed_at=? WHERE pairing_id=? AND claimed_at IS NULL AND expires_at>=?").run(claimedAt, pairingId, claimedAt);
      if (Number(result.changes) !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.db.prepare("INSERT INTO devices(workspace_id,device_id,device_type,name,token_hash,created_at) VALUES(?,?,?,?,?,?)")
        .run(mobile.workspaceId, mobile.deviceId, mobile.deviceType, mobile.name, mobile.tokenHash, mobile.createdAt);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  device(workspaceId: string, deviceId: string): DeviceRecord | undefined {
    const row = this.db.prepare("SELECT * FROM devices WHERE workspace_id=? AND device_id=?").get(workspaceId, deviceId) as any;
    return row ? { workspaceId: row.workspace_id, deviceId: row.device_id, deviceType: row.device_type, name: row.name, tokenHash: row.token_hash, createdAt: row.created_at, revokedAt: row.revoked_at ?? undefined, pushToken: row.push_token ?? undefined } : undefined;
  }

  savePushToken(workspaceId: string, deviceId: string, pushToken: string): boolean {
    return Number(this.db.prepare("UPDATE devices SET push_token=? WHERE workspace_id=? AND device_id=? AND revoked_at IS NULL").run(pushToken, workspaceId, deviceId).changes) === 1;
  }

  pushTokens(workspaceId: string): string[] {
    const rows = this.db.prepare("SELECT push_token FROM devices WHERE workspace_id=? AND revoked_at IS NULL AND push_token IS NOT NULL").all(workspaceId) as Array<{ push_token: string }>;
    return rows.map((row) => row.push_token);
  }

  revokeDevice(workspaceId: string, deviceId: string, revokedAt: number): boolean {
    return Number(this.db.prepare("UPDATE devices SET revoked_at=? WHERE workspace_id=? AND device_id=?").run(revokedAt, workspaceId, deviceId).changes) === 1;
  }

  appendEvent(event: Omit<SyncEvent, "sequence">): SyncEvent {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO workspace_sequences(workspace_id,sequence) VALUES(?,1) ON CONFLICT(workspace_id) DO UPDATE SET sequence=sequence+1").run(event.workspaceId);
      const sequence = Number((this.db.prepare("SELECT sequence FROM workspace_sequences WHERE workspace_id=?").get(event.workspaceId) as any).sequence);
      this.db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run(event.workspaceId, sequence, event.eventId, event.type, JSON.stringify(event.payload), event.createdAt);
      this.db.exec("COMMIT");
      return { ...event, sequence } as SyncEvent;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  eventsAfter(workspaceId: string, sequence: number, limit = 2_000): SyncEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE workspace_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(workspaceId, sequence, limit) as any[];
    return rows.map(toEvent);
  }

  latestSequence(workspaceId: string): number {
    return Number((this.db.prepare("SELECT sequence FROM workspace_sequences WHERE workspace_id=?").get(workspaceId) as any)?.sequence ?? 0);
  }

  latestSnapshot(workspaceId: string): SyncEvent | undefined {
    const row = this.db.prepare("SELECT * FROM events WHERE workspace_id=? AND type='snapshot' ORDER BY sequence DESC LIMIT 1").get(workspaceId) as any;
    return row ? toEvent(row) : undefined;
  }

  insertCommand(workspaceId: string, command: SyncCommand, createdAt: number): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO commands(workspace_id,client_mutation_id,command,created_at) VALUES(?,?,?,?)").run(workspaceId, command.clientMutationId, JSON.stringify(command), createdAt).changes) === 1;
  }

  pendingCommands(workspaceId: string): StoredCommand[] {
    const rows = this.db.prepare("SELECT * FROM commands WHERE workspace_id=? AND completed_at IS NULL ORDER BY created_at").all(workspaceId) as any[];
    return rows.map((row) => ({ workspaceId: row.workspace_id, command: JSON.parse(row.command), createdAt: row.created_at }));
  }

  completeCommand(workspaceId: string, clientMutationId: string, accepted: boolean, error?: string): boolean {
    return Number(this.db.prepare("UPDATE commands SET completed_at=?,accepted=?,error=? WHERE workspace_id=? AND client_mutation_id=?").run(Date.now(), accepted ? 1 : 0, error ?? null, workspaceId, clientMutationId).changes) === 1;
  }

  close(): void { this.db.close(); }
}

const toEvent = (row: any): SyncEvent => ({ sequence: row.sequence, eventId: row.event_id, workspaceId: row.workspace_id, type: row.type, payload: JSON.parse(row.payload), createdAt: row.created_at });
