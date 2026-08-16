import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") throw new Error("packaged macOS smoke test must run on macOS");
const appPath = path.resolve(process.argv[2] ?? "release/mac-arm64/XinyunOpen Bot.app");
const executable = path.join(appPath, "Contents", "MacOS", "XinyunOpen Bot");
const userData = mkdtempSync(path.join(os.tmpdir(), "xinyun-smoke-user-data-"));
const child = spawn(executable, [], {
  env: {
    ...process.env,
    OMB_USER_DATA: userData,
    OMB_DATA_DIR: path.join(userData, "server-data"),
    OMB_DISABLE_LOCAL_CUA: "1",
    OMB_DISABLE_UPDATES: "1",
    OMB_SMOKE_QUIT_AFTER_MS: "20000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => process.stdout.write(data));
child.stderr.on("data", (data) => process.stderr.write(data));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let health = null;
try {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:8799/api/health");
      const body = await response.json();
      if (response.ok && body?.app === "openmausbot" && body?.static) {
        health = body;
        break;
      }
    } catch {}
    if (child.exitCode !== null) throw new Error(`app exited early with code ${child.exitCode}`);
    await sleep(500);
  }
  if (!health) throw new Error("packaged server did not become healthy on 127.0.0.1:8799");

  const instancesResponse = await fetch("http://127.0.0.1:8799/api/instances");
  const instances = await instancesResponse.json();
  if (!instancesResponse.ok || !Array.isArray(instances.instances)) {
    throw new Error("/api/instances did not return an instances array");
  }
  console.log(`[smoke] health pid=${health.pid}; instances=${instances.instances.length}`);
} finally {
  for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt++) await sleep(250);
  if (child.exitCode === null) child.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt++) await sleep(250);
  if (child.exitCode === null) child.kill("SIGKILL");
  let portClosed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch("http://127.0.0.1:8799/api/health", { signal: AbortSignal.timeout(250) });
    } catch {
      portClosed = true;
      break;
    }
    await sleep(250);
  }
  rmSync(userData, { recursive: true, force: true });
  if (!portClosed) throw new Error("server still listens after the app exits");
}
