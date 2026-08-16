import { z } from "zod";

export const deviceTypeSchema = z.enum(["desktop", "ios"]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const clientHelloSchema = z.object({
  workspaceId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceType: deviceTypeSchema,
  lastSequence: z.number().int().nonnegative(),
  accessToken: z.string().min(16),
});
export type ClientHello = z.infer<typeof clientHelloSchema>;

export const syncEventTypeSchema = z.enum([
  "snapshot",
  "bot.updated",
  "group.updated",
  "message.added",
  "message.patched",
  "turn.started",
  "turn.delta",
  "turn.completed",
  "turn.interrupted",
  "approval.requested",
  "approval.resolved",
]);
export type SyncEventType = z.infer<typeof syncEventTypeSchema>;

export const syncEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  eventId: z.string().min(1),
  workspaceId: z.string().min(1),
  type: syncEventTypeSchema,
  payload: z.unknown(),
  createdAt: z.number().int().nonnegative(),
});
export interface SyncEvent<T = unknown> {
  sequence: number;
  eventId: string;
  workspaceId: string;
  type: SyncEventType;
  payload: T;
  createdAt: number;
}

export const syncCommandTypeSchema = z.enum([
  "message.send",
  "group.message.send",
  "turn.interrupt",
  "group.turn.interrupt",
  "approval.respond",
  "bot.update",
]);
export type SyncCommandType = z.infer<typeof syncCommandTypeSchema>;

export const syncCommandSchema = z.object({
  clientMutationId: z.string().min(8).max(128),
  type: syncCommandTypeSchema,
  payload: z.unknown(),
});
export interface SyncCommand<T = unknown> {
  clientMutationId: string;
  type: SyncCommandType;
  payload: T;
}

export const botSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  color: z.string(),
  unread: z.boolean(),
  busy: z.boolean().optional(),
  hidden: z.boolean().optional(),
});
export type BotSummary = z.infer<typeof botSummarySchema>;

export const groupSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  name: z.string(),
  memberIds: z.array(z.string()),
  unread: z.boolean(),
  busyBotId: z.string().nullable().optional(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const mobileMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["bot", "user"]),
  kind: z.enum(["text", "options", "activity", "screen"]),
  text: z.string().optional(),
  at: z.number(),
  card: z.unknown().optional(),
  tool: z.object({ name: z.string(), ok: z.boolean().optional() }).optional(),
  from: z.object({ botId: z.string(), name: z.string(), color: z.string() }).optional(),
});
export type MobileMessage = z.infer<typeof mobileMessageSchema>;

export const workspaceSnapshotSchema = z.object({
  workspaceId: z.string(),
  bots: z.array(botSummarySchema),
  groups: z.array(groupSummarySchema),
  messagesByThread: z.record(z.string(), z.array(mobileMessageSchema)),
  generatedAt: z.number(),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export const gatewayFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello"), hello: clientHelloSchema }),
  z.object({ kind: z.literal("ready"), latestSequence: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("event"), event: syncEventSchema }),
  z.object({ kind: z.literal("command"), command: syncCommandSchema }),
  z.object({ kind: z.literal("command.ack"), clientMutationId: z.string(), accepted: z.boolean(), error: z.string().optional() }),
  z.object({ kind: z.literal("ping"), at: z.number() }),
  z.object({ kind: z.literal("pong"), at: z.number() }),
  z.object({ kind: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type GatewayFrame = z.infer<typeof gatewayFrameSchema>;

export interface PairingCreateResponse {
  pairingId: string;
  code: string;
  expiresAt: number;
  workspaceId: string;
  desktopDeviceId: string;
  desktopAccessToken: string;
}

export interface PairingClaimResponse {
  workspaceId: string;
  deviceId: string;
  accessToken: string;
  gatewayUrl: string;
}

export const encodeFrame = (frame: GatewayFrame): string => JSON.stringify(frame);

export function decodeFrame(raw: string): GatewayFrame {
  return gatewayFrameSchema.parse(JSON.parse(raw));
}
