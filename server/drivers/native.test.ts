import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureDirs, NATIVE_DIR } from "../config.ts";
import { appendNative } from "./native.ts";

beforeAll(() => ensureDirs());

describe("appendNative", () => {
  it("masks session credentials before writing the native log", () => {
    appendNative("t-native", {
      dir: "out",
      source: "acp",
      msg: {
        method: "session/new",
        params: {
          mcpServers: [
            {
              name: "computer",
              env: [
                { name: "OGB_BOX_ID", value: "box-7" },
                { name: "OGB_BOX_TOKEN", value: "box_live_dontlogme" },
              ],
            },
          ],
        },
      },
    });

    const log = readFileSync(join(NATIVE_DIR, "t-native.ndjson"), "utf8");
    expect(log).not.toContain("box_live_dontlogme");
    expect(log).toContain("OGB_BOX_TOKEN");
    expect(log).toContain("box-7");
  });

  it("uses an owner-only mode where POSIX modes are available", () => {
    appendNative("t-mode", { dir: "in", source: "acp", msg: { hello: "world" } });
    const mode = statSync(join(NATIVE_DIR, "t-mode.ndjson")).mode & 0o777;
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });

  it("never lets serialization failures break a run", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => appendNative("t-cyclic", { dir: "in", source: "acp", msg: cyclic })).not.toThrow();
  });
});
