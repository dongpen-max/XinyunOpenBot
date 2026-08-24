import { describe, expect, it } from "vitest";
import { extensionForMime, IMAGE_MAX_BYTES, saveImage } from "./attachments.ts";

describe("image attachments", () => {
  it("accepts the supported image formats and normalizes parameters", () => {
    expect(extensionForMime("image/png; charset=binary")).toBe(".png");
    expect(extensionForMime("image/svg+xml")).toBeNull();
    expect(extensionForMime("image/webp")).toBe(".webp");
  });

  it("rejects empty and oversized images", () => {
    expect(() => saveImage(Buffer.alloc(0), "image/png")).toThrow("图片内容为空");
    expect(() => saveImage(Buffer.alloc(IMAGE_MAX_BYTES + 1), "image/png")).toThrow("超过");
  });
});
