import { describe, expect, it } from "vitest";
import { StreamingSpeechChunker } from "./index.ts";

describe("StreamingSpeechChunker", () => {
  it("emits completed Chinese sentences and keeps a tail", () => {
    const chunker = new StreamingSpeechChunker({ minCharacters: 4 });
    expect(chunker.push("你好。这是")).toEqual(["你好。"]);
    expect(chunker.push("第二句！")).toEqual(["这是第二句！"]);
    expect(chunker.flush()).toEqual([]);
  });
});
