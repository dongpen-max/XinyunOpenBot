import { describe, expect, it } from "vitest";

import {
  isAllowedCloudDesktopNavigation,
  isValidCloudDesktopBotId,
  parseCloudDesktopUrl,
  prepareCloudDesktopUrl,
  sanitizeCloudDesktopBounds,
  sanitizeCloudDesktopError,
} from "../electron/cloud-desktop-utils.mjs";

describe("cloud desktop URL validation", () => {
  it("accepts only credential-free HTTPS join URLs", () => {
    expect(parseCloudDesktopUrl("https://desktop.example.test/join?token=rotating")).not.toBeNull();
    expect(parseCloudDesktopUrl("http://desktop.example.test/join")).toBeNull();
    expect(parseCloudDesktopUrl("https://user:pass@desktop.example.test/join")).toBeNull();
    expect(parseCloudDesktopUrl("not a URL")).toBeNull();
  });

  it("keeps main-frame navigation on the exact trusted origin", () => {
    const allowed = new Set(["https://desktop.example.test"]);
    expect(isAllowedCloudDesktopNavigation("https://desktop.example.test/client/#session", allowed)).toBe(true);
    expect(isAllowedCloudDesktopNavigation("https://login.example.test/redirect", allowed)).toBe(false);
    expect(isAllowedCloudDesktopNavigation("https://desktop.example.test.evil.test/", allowed)).toBe(false);
  });

  it("forces noVNC to contain the full remote desktop inside the embedded viewport", () => {
    const url = prepareCloudDesktopUrl(
      "https://desktop.example.test/vnc.html?autoconnect=true&resize=remote&token=rotating",
    );
    expect(url?.searchParams.get("resize")).toBe("scale");
    expect(url?.searchParams.get("autoconnect")).toBe("true");
    expect(url?.searchParams.get("token")).toBe("rotating");
  });

  it("accepts only server-compatible bot ids", () => {
    expect(isValidCloudDesktopBotId("bot_12-alpha")).toBe(true);
    expect(isValidCloudDesktopBotId("../../config")).toBe(false);
    expect(isValidCloudDesktopBotId("bot id")).toBe(false);
  });
});

describe("cloud desktop bounds", () => {
  it("rejects non-finite renderer input", () => {
    expect(
      sanitizeCloudDesktopBounds(
        { x: 320, y: Number.NaN, width: 720, height: 500 },
        { width: 1440, height: 920 },
      ),
    ).toBeNull();
  });

  it("stays below the title bar and inside the BrowserWindow content area", () => {
    expect(
      sanitizeCloudDesktopBounds(
        { x: 320, y: 0, width: 5000, height: 5000 },
        { width: 1440, height: 920 },
      ),
    ).toEqual({ x: 320, y: 46, width: 1120, height: 874 });
  });

  it("uses the available area when a narrow center pane is smaller than the preferred minimum", () => {
    expect(
      sanitizeCloudDesktopBounds(
        { x: 720, y: 60, width: 80, height: 100 },
        { width: 900, height: 600 },
      ),
    ).toEqual({ x: 720, y: 60, width: 180, height: 180 });
  });
});

describe("cloud desktop error cleaning", () => {
  it("removes URLs, query tokens, and credential-shaped values", () => {
    const message = sanitizeCloudDesktopError(
      "failed https://desktop.example.test/join?token=super-secret access_token=another-secret abcdefghijklmnopqrstuvwxyz0123456789",
    );
    expect(message).toContain("云端桌面连接失败");
    expect(message).not.toContain("desktop.example.test");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("another-secret");
    expect(message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });
});
