import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedCloudDesktopPermission,
  isAllowedCloudDesktopNavigation,
  prepareCloudDesktopUrl,
} from "./cloud-desktop-utils.mjs";

test("cloud desktop permits only clipboard permissions required by the remote client", () => {
  assert.equal(isAllowedCloudDesktopPermission("clipboard-read"), true);
  assert.equal(isAllowedCloudDesktopPermission("clipboard-sanitized-write"), true);
  assert.equal(isAllowedCloudDesktopPermission("clipboard-write"), true);

  for (const permission of ["media", "notifications", "geolocation", "fullscreen", "openExternal", "" , null]) {
    assert.equal(isAllowedCloudDesktopPermission(permission), false);
  }
});

test("cloud desktop keeps noVNC scaling and origin-restricted navigation", () => {
  const url = prepareCloudDesktopUrl("https://desktop.example.test/view?token=opaque");
  assert.equal(url?.searchParams.get("resize"), "scale");
  assert.equal(url?.searchParams.get("view_only"), "false");
  assert.equal(url?.searchParams.get("viewOnly"), "false");
  assert.equal(url?.searchParams.get("interactive"), "true");
  assert.equal(isAllowedCloudDesktopNavigation(url?.href, new Set(["https://desktop.example.test"])), true);
  assert.equal(isAllowedCloudDesktopNavigation("https://other.example.test/view", new Set(["https://desktop.example.test"])), false);
});

test("cloud desktop clears noVNC view-only flags in the URL hash", () => {
  const url = prepareCloudDesktopUrl(
    "https://desktop.example.test/vnc.html#token=opaque&view_only=true&path=websockify",
  );
  const hash = new URLSearchParams(url?.hash.slice(1));
  assert.equal(hash.get("view_only"), "false");
  assert.equal(hash.get("viewOnly"), "false");
  assert.equal(hash.get("path"), "websockify");
});

test("cloud desktop controller relays keyboard events from an Electron overlay", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./cloud-desktop.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /win\.webContents\.on\("before-input-event", this\.forwardKeyboardInput\)/);
  assert.match(source, /view\.webContents\.sendInputEvent\(input\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /#noVNC_keyboardinput/);
  assert.match(source, /primeInputTarget/);
});

test("cloud desktop offers a browser input fallback without exposing join URLs to the renderer", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./cloud-desktop.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /async openInBrowser\(botId\)/);
  assert.match(source, /await shell\.openExternal\(url\.href\)/);
  assert.match(source, /cloud-desktop:open-in-browser/);
});
