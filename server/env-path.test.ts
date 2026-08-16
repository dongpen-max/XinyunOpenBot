// PATH augmentation contract (issues #8, #12): a CLI living in a
// well-known install dir — or an nvm bin dir — must be findable even
// when the process itself started with a bare GUI PATH.
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  augmentedPath,
  posixKnownDirs,
  resetPathCacheForTests,
  resolveCliSpawn,
  resolvePosixExecutable,
} from "./env-path.ts";

const posixIt = it.skipIf(process.platform === "win32");
const windowsIt = it.skipIf(process.platform !== "win32");

describe("augmentedPath", () => {
  afterEach(() => {
    delete process.env.OMB_EXTRA_PATH;
    resetPathCacheForTests();
  });

  it("keeps the existing PATH entries first", () => {
    resetPathCacheForTests();
    const path = augmentedPath();
    const firstExisting = (process.env.PATH ?? "").split(delimiter).filter(Boolean)[0];
    // OMB_EXTRA_PATH is unset here, so the inherited PATH leads
    expect(path.split(delimiter)[0]).toBe(firstExisting);
  });

  it("prepends OMB_EXTRA_PATH and dedupes", () => {
    process.env.OMB_EXTRA_PATH = ["/tmp/omb-extra", "/tmp/omb-extra"].join(delimiter);
    resetPathCacheForTests();
    const parts = augmentedPath().split(delimiter);
    expect(parts[0]).toBe("/tmp/omb-extra");
    expect(parts.filter((p) => p === "/tmp/omb-extra")).toHaveLength(1);
  });

  posixIt("includes nvm bin dirs from the home dir, newest node first", () => {
    // setup.ts points homedir at a temp dir, so this is hermetic
    const nvm = join(homedir(), ".nvm", "versions", "node");
    mkdirSync(join(nvm, "v9.0.0", "bin"), { recursive: true });
    mkdirSync(join(nvm, "v24.2.0", "bin"), { recursive: true });
    resetPathCacheForTests();

    const parts = augmentedPath().split(delimiter);
    const v24 = parts.indexOf(join(nvm, "v24.2.0", "bin"));
    const v9 = parts.indexOf(join(nvm, "v9.0.0", "bin"));
    expect(v24).toBeGreaterThan(-1);
    expect(v9).toBeGreaterThan(-1);
    // numeric sort: v24 outranks v9 despite lexicographic order
    expect(v24).toBeLessThan(v9);
  });

  posixIt("makes a CLI in a known install dir spawnable despite a bare PATH", async () => {
    const bin = join(homedir(), ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const fake = join(bin, "omb-fake-cli");
    writeFileSync(fake, "#!/bin/sh\necho found-me\n");
    chmodSync(fake, 0o755);
    resetPathCacheForTests();

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "omb-fake-cli",
        [],
        // bare GUI-style PATH + our augmentation — the augmentation must win
        { env: { PATH: augmentedPath() } },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    });
    expect(stdout.trim()).toBe("found-me");
  });

  it("skips known dirs that do not exist", () => {
    resetPathCacheForTests();
    const parts = augmentedPath().split(delimiter);
    // temp home: .volta was never created, so it must not appear
    expect(parts).not.toContain(join(homedir(), ".volta", "bin"));
  });
});

describe("macOS CLI locations", () => {
  it("covers Apple Silicon and Intel Homebrew", () => {
    const dirs = posixKnownDirs("/Users/tester", {}, "darwin");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/usr/local/bin");
  });

  it("covers npm and pnpm global bins without hardcoding a user name", () => {
    const dirs = posixKnownDirs(
      "/Users/tester",
      { NPM_CONFIG_PREFIX: "/Volumes/Tools With Spaces/npm", PNPM_HOME: "/Volumes/Tools With Spaces/pnpm" },
      "darwin",
    );
    expect(dirs).toContain("/Volumes/Tools With Spaces/npm/bin");
    expect(dirs).toContain("/Volumes/Tools With Spaces/pnpm");
    expect(dirs).toContain("/Users/tester/Library/pnpm");
  });

  posixIt("resolves an executable from a PATH containing spaces", () => {
    const bin = join(homedir(), "CLI Tools", "bin");
    mkdirSync(bin, { recursive: true });
    const cli = join(bin, "claude");
    writeFileSync(cli, "#!/bin/sh\nexit 0\n");
    chmodSync(cli, 0o755);
    expect(resolvePosixExecutable("claude", bin)).toBe(cli);
  });

  posixIt("returns null when a CLI is absent", () => {
    expect(resolvePosixExecutable("definitely-not-installed", join(homedir(), "empty-bin"))).toBeNull();
  });

  posixIt("rejects a non-executable file", () => {
    const bin = join(homedir(), "not-executable", "bin");
    mkdirSync(bin, { recursive: true });
    const cli = join(bin, "codex");
    writeFileSync(cli, "#!/bin/sh\nexit 0\n");
    chmodSync(cli, 0o644);
    expect(resolvePosixExecutable("codex", bin)).toBeNull();
  });
});

describe("resolveCliSpawn on Windows", () => {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.PATHEXT = originalPathExt;
    resetPathCacheForTests();
  });

  windowsIt("prefers an npm Codex shim over a Microsoft Store WindowsApps executable", () => {
    const root = join(homedir(), "codex-resolution");
    const windowsApps = join(root, "WindowsApps", "OpenAI.Codex_test", "app", "resources");
    const npm = join(root, "npm");
    const script = join(npm, "node_modules", "@openai", "codex", "bin", "codex.js");
    mkdirSync(windowsApps, { recursive: true });
    mkdirSync(join(npm, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    writeFileSync(join(windowsApps, "codex.exe"), "");
    writeFileSync(join(npm, "node.exe"), "");
    writeFileSync(script, "#!/usr/bin/env node\n");
    writeFileSync(join(npm, "codex.cmd"), '@"%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n');
    process.env.PATH = [windowsApps, npm].join(delimiter);
    process.env.PATHEXT = ".EXE;.CMD";
    resetPathCacheForTests();

    expect(resolveCliSpawn("codex", ["--version"])).toEqual({
      command: join(npm, "node.exe"),
      args: [script, "--version"],
    });
  });

  windowsIt("respects an explicitly configured WindowsApps Codex path", () => {
    const cli = join(homedir(), "WindowsApps", "OpenAI.Codex_test", "codex.exe");
    mkdirSync(join(cli, ".."), { recursive: true });
    writeFileSync(cli, "");

    expect(resolveCliSpawn(cli, ["--version"])).toEqual({ command: cli, args: ["--version"] });
  });
});
