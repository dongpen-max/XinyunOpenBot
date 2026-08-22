import { describe, expect, it } from "vitest";

import { buildTurnContext, engineIsFresh } from "./turn-context.ts";

const transcript = [
  { role: "user" as const, text: "my dog is named Biscuit" },
  { role: "assistant" as const, text: "Noted — Biscuit." },
];

describe("buildTurnContext", () => {
  it("passes normal resumed turns through", () => {
    expect(buildTurnContext({ text: "hi", transcript, rewound: false, fresh: false, replaysNatively: false })).toEqual({
      turnText: "hi",
      resume: true,
    });
  });

  it("replays history after rewind", () => {
    const result = buildTurnContext({ text: "hi", transcript, rewound: true, fresh: false, replaysNatively: false });
    expect(result.resume).toBe(false);
    expect(result.turnText).toContain("rewound this conversation");
    expect(result.turnText).toContain("User: my dog is named Biscuit");
  });

  it("replays history when a different engine joins", () => {
    const result = buildTurnContext({ text: "hi", transcript, rewound: false, fresh: true, replaysNatively: false });
    expect(result.resume).toBe(false);
    expect(result.turnText).toContain("joining this conversation");
    expect(result.turnText).not.toContain("rewound");
    expect(result.turnText).toContain("Assistant: Noted — Biscuit.");
  });

  it("does not wrap transcript-replay drivers", () => {
    const result = buildTurnContext({ text: "hi", transcript, rewound: false, fresh: true, replaysNatively: true });
    expect(result).toEqual({ turnText: "hi", resume: false });
  });

  it("starts fresh without wrapping empty history", () => {
    expect(buildTurnContext({ text: "hi", transcript: [], rewound: false, fresh: true, replaysNatively: false })).toEqual({
      turnText: "hi",
      resume: false,
    });
  });
});

describe("engineIsFresh", () => {
  it("is false when the same instance ran last", () => {
    expect(engineIsFresh({ instanceId: "claude", lastInstanceId: "claude", resumeCursors: { claude: "s1" }, transcript })).toBe(false);
  });

  it("is true when another instance ran last", () => {
    expect(engineIsFresh({ instanceId: "claude", lastInstanceId: "codex", resumeCursors: { claude: "old", codex: "new" }, transcript })).toBe(true);
  });

  it("ignores a seeded greeting without a user turn", () => {
    expect(engineIsFresh({ instanceId: "claude", lastInstanceId: undefined, resumeCursors: {}, transcript: [{ role: "assistant", text: "Hello" }] })).toBe(false);
  });

  it("handles legacy tasks without lastInstanceId conservatively", () => {
    expect(engineIsFresh({ instanceId: "claude", lastInstanceId: undefined, resumeCursors: { claude: "s1" }, transcript })).toBe(false);
    expect(engineIsFresh({ instanceId: "codex", lastInstanceId: undefined, resumeCursors: { claude: "s1" }, transcript })).toBe(true);
    expect(engineIsFresh({ instanceId: "claude", lastInstanceId: undefined, resumeCursors: { claude: "s1", codex: "s2" }, transcript })).toBe(true);
  });
});
