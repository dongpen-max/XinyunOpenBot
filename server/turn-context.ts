export interface TurnContextInput {
  text: string;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  rewound: boolean;
  fresh: boolean;
  replaysNatively: boolean;
}

export function engineIsFresh(input: {
  instanceId: string;
  lastInstanceId: string | undefined;
  resumeCursors: Record<string, unknown>;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
}): boolean {
  const { instanceId, lastInstanceId, resumeCursors, transcript } = input;
  if (!transcript.some((message) => message.role === "user")) return false;
  if (lastInstanceId !== undefined) return lastInstanceId !== instanceId;
  const cursorIds = Object.keys(resumeCursors);
  return !(cursorIds.length === 1 && cursorIds[0] === instanceId);
}

const REWOUND_PREAMBLE =
  "[The user rewound this conversation (edited a message or switched to another version). Everything before this point was replaced by the following history:]";
const FRESH_PREAMBLE =
  "[You are joining this conversation mid-thread (the user switched this bot over to you). The conversation so far:]";

export function buildTurnContext(input: TurnContextInput): { turnText: string; resume: boolean } {
  const { text, transcript, rewound, fresh, replaysNatively } = input;
  const resume = !rewound && !fresh;
  if (resume || replaysNatively || transcript.length === 0) return { turnText: text, resume };
  return {
    turnText: [
      rewound ? REWOUND_PREAMBLE : FRESH_PREAMBLE,
      "",
      ...transcript.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`),
      "",
      "[Now reply to the user's latest message:]",
      "",
      text,
    ].join("\n"),
    resume,
  };
}
