type TimelineMessage = {
  id: string;
  at: number;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen";
  text?: string;
  png?: string;
  tool?: { name: string; ok?: boolean };
};

export interface TimelineEvent {
  id: string;
  at: number;
  label: string;
  state: "complete" | "failed" | "observed";
  kind: "task" | "tool" | "screen" | "result";
}

function compactLabel(text: string, fallback: string): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value ? `${fallback}：${value.length > 34 ? `${value.slice(0, 33)}…` : value}` : fallback;
}

/** Derive only persisted, observable events; the timeline never guesses. */
export function timelineEvents(messages: TimelineMessage[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const message of messages) {
    if (message.kind === "text" && message.role === "user" && message.text?.trim()) {
      events.push({ id: message.id, at: message.at, label: compactLabel(message.text, "任务开始"), state: "observed", kind: "task" });
    } else if (message.kind === "activity" && message.tool) {
      const failed = message.tool.ok === false || message.tool.name.startsWith("error:");
      events.push({
        id: message.id,
        at: message.at,
        label: failed ? message.tool.name.replace(/^error:\s*/i, "") : message.tool.name,
        state: failed ? "failed" : "complete",
        kind: "tool",
      });
    } else if (message.kind === "screen") {
      events.push({ id: message.id, at: message.at, label: "观察云电脑画面", state: "observed", kind: "screen" });
    } else if (message.kind === "text" && message.role === "bot" && message.text?.trim()) {
      events.push({ id: message.id, at: message.at, label: compactLabel(message.text, "回复完成"), state: "complete", kind: "result" });
    }
  }
  return events;
}
