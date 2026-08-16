import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { desktopCapabilities, localComputerReady } = require("./capabilities.cjs");

describe("desktop capabilities", () => {
  it("reports native macOS features and a ready local CUA connection", () => {
    expect(
      desktopCapabilities({
        platform: "darwin",
        packaged: true,
        localConnection: { mode: "embedded" },
      }),
    ).toMatchObject({
      host: { platform: "darwin", packaged: true },
      windowChrome: "mac-inset",
      screenPreview: { available: true },
      dictation: { available: true, engine: "apple-speech" },
      localComputer: { available: true },
    });
  });

  it.each(["linux", "win32", "freebsd"])("fails closed on %s", (platform) => {
    const capabilities = desktopCapabilities({
      platform,
      localConnection: { mode: "embedded" },
    });
    expect(capabilities.screenPreview.available).toBe(false);
    expect(capabilities.dictation.available).toBe(false);
    expect(capabilities.localComputer).toEqual({
      available: false,
      reasonCode: "unsupported-platform",
    });
  });

  it("requires a live macOS connection instead of a provider name", () => {
    expect(localComputerReady("darwin", { mode: "unavailable" })).toBe(false);
    expect(localComputerReady("darwin", { mode: "standalone" })).toBe(true);
    expect(localComputerReady("win32", { mode: "embedded" })).toBe(false);
  });
});
