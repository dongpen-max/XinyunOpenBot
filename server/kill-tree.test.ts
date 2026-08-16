import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import { killCliTree } from "./procs.ts";

const IDLE = "setInterval(() => {}, 1000)";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("killCliTree", () => {
  it("reaps a CLI grandchild instead of leaving its MCP helper running", async () => {
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `const c=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(IDLE)}],{stdio:"ignore"});` +
          `console.log(c.pid);${IDLE}`,
      ],
      { stdio: ["ignore", "pipe", "ignore"], detached: true },
    );
    let grandchild = 0;
    try {
      grandchild = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("helper pid timeout")), 5_000);
        parent.stdout!.once("data", (chunk) => {
          clearTimeout(timer);
          resolve(Number(String(chunk).trim()));
        });
      });
      expect(alive(grandchild)).toBe(true);
      killCliTree(parent);
      const deadline = Date.now() + 10_000;
      while ((alive(grandchild) || (parent.exitCode === null && parent.signalCode === null)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(alive(grandchild)).toBe(false);
      expect(parent.exitCode !== null || parent.signalCode !== null).toBe(true);
    } finally {
      killCliTree(parent);
      if (grandchild && alive(grandchild)) {
        try { process.kill(grandchild, "SIGKILL"); } catch {}
      }
    }
  }, 20_000);
});
