// Windows local-computer bridge contract: it must speak MCP on stdio and
// expose the native CUA tools that turn a local-selection into actual control.
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "local-computer-proxy.ts");
describe.skipIf(process.platform !== "win32")("Windows local computer MCP bridge", () => {
  let child: ChildProcess;
  const pending = new Map<number, (message: any) => void>();
  let nextId = 1;

  const rpc = (method: string, params: unknown = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20_000).unref?.();
    });

  beforeAll(async () => {
    child = spawn(process.execPath, ["--experimental-strip-types", PROXY], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    child.stdout!.on("data", (chunk) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    await rpc("initialize", { protocolVersion: "2024-11-05" });
  }, 30_000);

  afterAll(() => child?.kill());

  it("advertises desktop state and native input controls", async () => {
    const response = await rpc("tools/list");
    const names = response.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["get_desktop_state", "click", "type_text"]));
  });
});
