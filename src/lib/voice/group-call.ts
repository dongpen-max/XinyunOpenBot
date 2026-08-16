export interface GroupCallMessage {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen";
  text?: string;
  from?: { botId: string };
}

export interface GroupCallReply {
  messageId: string;
  botId: string;
  text: string;
}

export interface GroupCallCollection {
  replies: GroupCallReply[];
  seenMessageIds: Set<string>;
}

/**
 * Fold the latest room transcript into a call-session queue.
 *
 * Every observed ID is remembered, including messages that cannot be spoken,
 * so a later render cannot turn an old activity/user message into queue noise.
 * Eligible replies retain transcript order and their real sender bot ID.
 */
export function collectGroupCallReplies(
  messages: readonly GroupCallMessage[],
  alreadySeen: ReadonlySet<string>,
): GroupCallCollection {
  const seenMessageIds = new Set(alreadySeen);
  const replies: GroupCallReply[] = [];

  for (const message of messages) {
    if (seenMessageIds.has(message.id)) continue;
    seenMessageIds.add(message.id);

    const text = message.text?.trim();
    const botId = message.from?.botId;
    if (message.role !== "bot" || message.kind !== "text" || !text || !botId) continue;

    replies.push({ messageId: message.id, botId, text });
  }

  return { replies, seenMessageIds };
}
