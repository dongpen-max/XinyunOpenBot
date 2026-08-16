import type { RuntimeEvent } from "../contracts.ts";

// Kept structurally identical to packages/contracts. These declarations are
// local so the packaged zero-dependency desktop server does not pull a
// workspace source package into dist-server at runtime.
export type SyncEventType =
  | "snapshot" | "bot.updated" | "group.updated" | "message.added" | "message.patched"
  | "turn.started" | "turn.delta" | "turn.completed" | "turn.interrupted"
  | "approval.requested" | "approval.resolved";
export interface SyncEvent<T = unknown> {
  sequence: number;
  eventId: string;
  workspaceId: string;
  type: SyncEventType;
  payload: T;
  createdAt: number;
}
export interface SyncCommand<T = unknown> {
  clientMutationId: string;
  type: "message.send" | "group.message.send" | "turn.interrupt" | "group.turn.interrupt" | "approval.respond" | "bot.update";
  payload: T;
}

type DesktopBroadcast = Record<string, any> & { kind?: string };

export function broadcastToSyncEvent(workspaceId: string, payload: unknown): Omit<SyncEvent, "sequence"> | null {
  if (!payload || typeof payload !== "object") return null;
  const frame = payload as DesktopBroadcast;
  let type: SyncEventType | null = null;
  let eventPayload: unknown = frame;
  if (frame.kind === "bot" && frame.bot) { type = "bot.updated"; eventPayload = frame.bot; }
  else if (frame.kind === "group" && frame.group) { type = "group.updated"; eventPayload = frame.group; }
  else if (frame.kind === "message") { type = "message.added"; eventPayload = { threadId: frame.threadId, message: frame.message }; }
  else if (frame.kind === "message.patch") { type = "message.patched"; eventPayload = { threadId: frame.threadId, message: frame.message }; }
  else if (frame.kind === "runtime" && frame.event) return runtimeToSyncEvent(workspaceId, frame.event as RuntimeEvent);
  if (!type) return null;
  return { eventId: `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`, workspaceId, type, payload: eventPayload, createdAt: Date.now() };
}

function runtimeToSyncEvent(workspaceId: string, event: RuntimeEvent): Omit<SyncEvent, "sequence"> | null {
  let type: SyncEventType | null = null;
  let payload: unknown = event;
  if (event.type === "turn.started") type = "turn.started";
  else if (event.type === "content.delta" && event.streamKind === "assistant_text") { type = "turn.delta"; payload = { threadId: event.threadId, turnId: event.turnId, delta: event.delta }; }
  else if (event.type === "turn.completed") type = /interrupt|cancel/i.test(event.stopReason ?? "") ? "turn.interrupted" : "turn.completed";
  else if (event.type === "request.opened") type = "approval.requested";
  else if (event.type === "request.resolved") type = "approval.resolved";
  if (!type) return null;
  return { eventId: event.eventId, workspaceId, type, payload, createdAt: Date.parse(event.createdAt) || Date.now() };
}

export interface LocalRequest { path: string; method: "POST" | "PATCH"; body?: unknown; }

export function commandToLocalRequest(command: SyncCommand): LocalRequest {
  const payload = (command.payload ?? {}) as Record<string, any>;
  switch (command.type) {
    case "message.send":
      if (!payload.botId || !payload.text) throw new Error("message.send requires botId and text");
      return { path: `/api/bots/${encodeURIComponent(payload.botId)}/messages`, method: "POST", body: { text: payload.text } };
    case "group.message.send":
      if (!payload.groupId || !payload.text) throw new Error("group.message.send requires groupId and text");
      return { path: `/api/groups/${encodeURIComponent(payload.groupId)}/messages`, method: "POST", body: { text: payload.text } };
    case "turn.interrupt":
      if (!payload.botId) throw new Error("turn.interrupt requires botId");
      return { path: `/api/bots/${encodeURIComponent(payload.botId)}/interrupt`, method: "POST" };
    case "group.turn.interrupt":
      if (!payload.groupId) throw new Error("group.turn.interrupt requires groupId");
      return { path: `/api/groups/${encodeURIComponent(payload.groupId)}/interrupt`, method: "POST" };
    case "approval.respond":
      if (!payload.threadId || !payload.requestId) throw new Error("approval.respond requires threadId and requestId");
      return { path: `/api/threads/${encodeURIComponent(payload.threadId)}/respond`, method: "POST", body: { requestId: payload.requestId, behavior: payload.behavior, message: payload.message } };
    case "bot.update":
      if (!payload.botId || !payload.patch || typeof payload.patch !== "object") throw new Error("bot.update requires botId and patch");
      return { path: `/api/bots/${encodeURIComponent(payload.botId)}`, method: "PATCH", body: payload.patch };
  }
  throw new Error(`unsupported command: ${(command as { type: string }).type}`);
}
