import { describe, expect, it } from "vitest";

import {
  attachmentsFromFiles,
  composeMessage,
  escapeAttribute,
  fileAttachment,
  isLongPaste,
  pasteAttachment,
} from "../src/lib/composer-attachments.ts";
import { getDraft, getDraftAttachments, getReasoningLevel } from "../src/lib/drafts.ts";

describe("composer attachments", () => {
  it("turns long paste and file paths into bounded prompt blocks", () => {
    expect(isLongPaste("x".repeat(900))).toBe(true);
    const prompt = composeMessage("请检查", [
      pasteAttachment("const answer = 42;", "answer.ts"),
      fileAttachment("a&b.pdf", 'C:\\temp\\a&b".pdf', 12),
    ]);
    expect(prompt).toContain('<pasted-text index="1" name="answer.ts">');
    expect(prompt).toContain('path="C:\\temp\\a&amp;b&quot;.pdf"');
    expect(escapeAttribute("a\nb")).toBe("a&#10;b");
  });

  it("inlines small text files and keeps binary desktop files by path", async () => {
    const files = [
      { name: "notes.md", size: 5, type: "text/markdown", text: async () => "hello" },
      { name: "scan.pdf", size: 20, type: "application/pdf", text: async () => "ignored" },
    ];
    const result = await attachmentsFromFiles(files, (file) => (file.name.endsWith(".pdf") ? "C:\\docs\\scan.pdf" : ""));
    expect(result.rejectedNames).toEqual([]);
    expect(result.attachments[0]).toMatchObject({ kind: "paste", name: "notes.md", text: "hello" });
    expect(result.attachments[1]).toMatchObject({ kind: "file", path: "C:\\docs\\scan.pdf" });
  });
});

describe("composer draft decoding", () => {
  const values = new Map<string, string>([
    ["xinyun-drafts", JSON.stringify({ thread: "未发送内容" })],
    ["xinyun-draft-attachments", JSON.stringify({ thread: [pasteAttachment("draft")] })],
    ["xinyun-reasoning-level", JSON.stringify({ thread: "maximum" })],
    ["xinyun-reasoning-effort", JSON.stringify({ legacyHigh: "high", legacyLow: "low" })],
  ]);
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: () => {} };

  it("restores text, attachment, and per-thread reasoning mode", () => {
    expect(getDraft(store, "thread")).toBe("未发送内容");
    expect(getDraftAttachments(store, "thread")).toHaveLength(1);
    expect(getReasoningLevel(store, "thread")).toBe("maximum");
    expect(getReasoningLevel(store, "missing")).toBe("medium");
  });

  it("migrates the old three-stop storage without lowering the old maximum", () => {
    expect(getReasoningLevel(store, "legacyHigh")).toBe("maximum");
    expect(getReasoningLevel(store, "legacyLow")).toBe("low");
  });
});
