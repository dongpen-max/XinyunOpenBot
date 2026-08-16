import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "xinyun-ios-e2e-"));
const gatewayPort = 18878 + Math.floor(Math.random() * 100);
const desktopPort = gatewayPort + 1;
const children = [];

const start = (entry, env) => {
  const child = spawn(process.execPath, ["--experimental-strip-types", entry], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  children.push({ child, getOutput: () => output });
  return child;
};

const waitFor = async (url, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const nextFrames = (socket, predicate, timeout = 10_000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out waiting for websocket frame")), timeout);
  const onMessage = (event) => {
    const frame = JSON.parse(String(event.data));
    if (!predicate(frame)) return;
    clearTimeout(timer);
    socket.removeEventListener("message", onMessage);
    resolvePromise(frame);
  };
  socket.addEventListener("message", onMessage);
});

try {
  start(join(root, "services/sync-gateway/src/index.ts"), { PORT: String(gatewayPort), HOST: "127.0.0.1", SYNC_DATABASE_PATH: join(scratch, "gateway.sqlite"), SYNC_PUBLIC_URL: `http://127.0.0.1:${gatewayPort}` });
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`);
  start(join(root, "server/index.ts"), { OMB_PORT: String(desktopPort), OMB_DATA_DIR: join(scratch, "desktop") });
  await waitFor(`http://127.0.0.1:${desktopPort}/api/health`);

  const pairingResponse = await fetch(`http://127.0.0.1:${desktopPort}/api/mobile-sync/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gatewayUrl: `http://127.0.0.1:${gatewayPort}` }) });
  if (!pairingResponse.ok) throw new Error(`desktop pairing failed: ${await pairingResponse.text()}`);
  const pairing = await pairingResponse.json();
  const claimResponse = await fetch(`http://127.0.0.1:${gatewayPort}/v1/pairings/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code, deviceName: "E2E iPhone" }) });
  if (!claimResponse.ok) throw new Error(`mobile claim failed: ${await claimResponse.text()}`);
  const claim = await claimResponse.json();

  const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/sync`);
  await new Promise((resolvePromise, reject) => { socket.addEventListener("open", resolvePromise, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const snapshotFrame = nextFrames(socket, (frame) => frame.kind === "event" && frame.event?.type === "snapshot");
  socket.send(JSON.stringify({ kind: "hello", hello: { workspaceId: claim.workspaceId, deviceId: claim.deviceId, deviceType: "ios", lastSequence: 0, accessToken: claim.accessToken } }));
  const snapshot = await snapshotFrame;
  if (!Array.isArray(snapshot.event.payload?.bots) || snapshot.event.payload.bots.length === 0) throw new Error("desktop snapshot did not contain bots");

  const bot = snapshot.event.payload.bots[0];
  const updatedFrame = nextFrames(socket, (frame) => frame.kind === "event" && frame.event?.type === "bot.updated" && frame.event.payload?.id === bot.id);
  socket.send(JSON.stringify({ kind: "command", command: { clientMutationId: `e2e-${Date.now()}`, type: "bot.update", payload: { botId: bot.id, patch: { title: "iOS E2E" } } } }));
  const updated = await updatedFrame;
  if (updated.event.payload.title !== "iOS E2E") throw new Error("mobile command did not mutate authoritative desktop state");
  socket.close();
  console.log(JSON.stringify({ ok: true, workspaceId: claim.workspaceId, snapshotSequence: snapshot.event.sequence, mutationSequence: updated.event.sequence, botId: bot.id }, null, 2));
} catch (error) {
  for (const item of children) process.stderr.write(item.getOutput());
  throw error;
} finally {
  for (const { child } of children) child.kill("SIGTERM");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  await rm(scratch, { recursive: true, force: true });
}
