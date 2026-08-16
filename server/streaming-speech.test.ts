import { describe, expect, it } from "vitest";

import { StreamingSpeechBuffer } from "../src/lib/voice/streaming-speech.ts";

describe("StreamingSpeechBuffer", () => {
  it("holds short sentences until they form one natural speech chunk", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 15, maxChars: 36 });

    expect(buffer.update("第一句还没写完")).toEqual([]);
    expect(buffer.update("第一句还没写完。第二句")).toEqual([]);
    expect(buffer.update("第一句还没写完。第二句也好了！第三句")).toEqual([
      "第一句还没写完。第二句也好了！",
    ]);
    expect(buffer.update("第一句还没写完。第二句也好了！第三句", { final: true })).toEqual(["第三句"]);
  });

  it("emits several newly completed sentences as one chunk", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 6, maxChars: 12 });
    expect(buffer.update("一。二？三！")).toEqual(["一。二？三！"]);
    expect(buffer.update("一。二？三！")).toEqual([]);
  });

  it("flushes a short completed sentence after a real stream pause", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 20, maxChars: 40 });
    expect(buffer.update("短句完成。还有后文")).toEqual([]);
    expect(buffer.update("短句完成。还有后文", { idle: true })).toEqual(["短句完成。"]);
  });

  it("flushes a useful prefix after an idle pause", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 8, maxChars: 40 });
    const text = "这是一段没有标点但是已经足够长的回答";

    expect(buffer.update(text)).toEqual([]);
    expect(buffer.update(text, { idle: true })).toEqual(["这是一段没有标点"]);
    expect(buffer.update(text, { final: true })).toEqual(["但是已经足够长的回答"]);
  });

  it("does not wait for a pause after an unpunctuated reply reaches the hard cap", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 8, maxChars: 12 });
    expect(buffer.update("一二三四五六七八九十甲乙")).toEqual(["一二三四五六七八"]);
  });

  it("does not split decimal numbers or common abbreviations", () => {
    const buffer = new StreamingSpeechBuffer();
    expect(buffer.update("耗时 11.7 秒，例如 i.e. 这是近似值。下一句。", { final: true })).toEqual([
      "耗时 11.7 秒，例如 i.e. 这是近似值。下一句。",
    ]);
  });

  it("does not expose the inside of a fenced code block", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 10, maxChars: 18 });
    const open = "说明如下。\n```ts\nconst secret = 1;\nconsole.log(secret);";
    const closed = `${open}\n` + "```\n已经完成。";

    expect(buffer.update(open)).toEqual(["说明如下。"]);
    expect(buffer.update(open, { idle: true })).toEqual([]);
    expect(buffer.update(closed)).toEqual(["```ts\nconst secret = 1;\nconsole.log(secret);\n```"]);
    expect(buffer.update(closed, { idle: true })).toEqual(["已经完成。"]);
  });

  it("waits for an incomplete Markdown link during idle flush", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 8, maxChars: 16 });
    const partial = "请查看[项目说明](https://example";

    expect(buffer.update(partial, { idle: true })).toEqual(["请查看"]);
    expect(buffer.update(`${partial}.com/docs) 了解详情。`)).toEqual([
      "[项目说明](https://example.com/docs) 了解详情。",
    ]);
  });

  it("uses the settled message only to flush the unread tail", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 5, maxChars: 20 });
    expect(buffer.update("已经播放。还剩尾句")).toEqual(["已经播放。"]);
    expect(buffer.update("已经播放。还剩尾句。", { final: true })).toEqual(["还剩尾句。"]);
    expect(buffer.update("已经播放。还剩尾句。", { final: true })).toEqual([]);
  });

  it("recovers conservatively if a provider rewrites an unspoken suffix", () => {
    const buffer = new StreamingSpeechBuffer({ preferredChars: 3, maxChars: 20 });
    expect(buffer.update("前句。旧的尾巴")).toEqual(["前句。"]);
    expect(buffer.update("前句。新的尾巴。", { final: true })).toEqual(["新的尾巴。"]);
  });
});
