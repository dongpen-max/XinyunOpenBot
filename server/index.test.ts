// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. The config pins one deliberately-unknown driver so the
// suite is deterministic with or without agent CLIs installed — and pins
// the shadow-instance behavior end to end while it's at it.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess;
/** stands in for the box provider so config saving never touches the network */
let boxStub: Server;
let boxStubPort = 0;
let voiceStub: Server;
let voiceStubPort = 0;
let mcpStub: Server;
let mcpStubPort = 0;
const mcpRequests: Array<{ method: string; headers: Record<string, string | string[] | undefined>; body: any }> = [];
const voiceSpeechBodies: Array<Record<string, unknown>> = [];
let home: string;
let stderr = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const apiWithHeaders = (path: string, headers: Record<string, string>): Promise<{ status: number; body: any }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: PORT, path, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end();
  });

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-api-test-"));
  // A fleet of exactly one unknown driver: no CLI probes, no network.
  // Custom instances are additive, so the default fleet is switched off
  // entry by entry — which pins the `enabled: false` opt-out too.
  mkdirSync(join(home, ".openmausbot"), { recursive: true });
  const off = { enabled: false };
  writeFileSync(
    join(home, ".openmausbot", "config.json"),
    JSON.stringify({
      instances: {
        ghost: { driver: "not-a-real-driver", displayName: "Ghost" },
        grok: off,
        opencode: off,
        kimi: off,
        claude: off,
        codex: off,
        antigravity: off,
        computer: off,
      },
    }),
  );

  boxStub = createServer((req, res) => {
    const ok = req.headers.authorization === "Bearer box_good";
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true, boxes: [] } : { ok: false, code: "unauthorized" }));
  });
  await new Promise<void>((r) => boxStub.listen(0, "127.0.0.1", r));
  boxStubPort = (boxStub.address() as { port: number }).port;

  voiceStub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      if (req.url === "/v1/audio/transcriptions") {
        const ok = req.headers.authorization === "Bearer stt_secret";
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
        return res.end(JSON.stringify(ok ? { text: "你好，星云" } : { error: { message: "bad stt key" } }));
      }
      if (req.url === "/v1/audio/speech") {
        voiceSpeechBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        const ok = req.headers.authorization === "Bearer tts_secret";
        res.writeHead(ok ? 200 : 401, { "content-type": ok ? "audio/mpeg" : "application/json" });
        return res.end(ok ? Buffer.from([0x49, 0x44, 0x33, 0x04]) : JSON.stringify({ error: { message: "bad tts key" } }));
      }
      if (req.url === "/v1/models") {
        const ok = req.headers.authorization === "Bearer domestic_secret";
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
        return res.end(JSON.stringify(ok
          ? { data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }, { id: "bad model id" }] }
          : { error: { message: "bad domestic key" } }));
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  await new Promise<void>((r) => voiceStub.listen(0, "127.0.0.1", r));
  voiceStubPort = (voiceStub.address() as { port: number }).port;

  mcpStub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      if (req.method === "DELETE") {
        res.writeHead(204);
        return res.end();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      mcpRequests.push({ method: req.method ?? "", headers: req.headers, body });
      const result = body.method === "initialize"
        ? { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fixture", version: "1" } }
        : { tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" } }] };
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "fixture-session" });
      res.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`);
    });
  });
  await new Promise<void>((r) => mcpStub.listen(0, "127.0.0.1", r));
  mcpStubPort = (mcpStub.address() as { port: number }).port;

  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
      OMB_BOX_API: `http://127.0.0.1:${boxStubPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (c) => (stderr += c));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}, 30_000);

afterAll(async () => {
  boxStub?.close();
  voiceStub?.close();
  mcpStub?.close();
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on("close", () => resolve());
    setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("harness HTTP API", () => {
  it("identifies itself on /api/health", async () => {
    const { status, body } = await api("GET", "/api/health");
    expect(status).toBe(200);
    expect(body.app).toBe("openmausbot");
    expect(typeof body.pid).toBe("number");
  });

  it("accepts loopback origins and rejects non-loopback Host or Origin headers", async () => {
    const allowed = await fetch(`${BASE}/api/health`, { headers: { origin: `http://localhost:${PORT}` } });
    expect(allowed.status).toBe(200);

    const badOrigin = await fetch(`${BASE}/api/health`, { headers: { origin: "https://evil.example" } });
    expect(badOrigin.status).toBe(403);
    expect(((await badOrigin.json()) as { error: string }).error).toContain("cross-origin");

    const badHost = await apiWithHeaders("/api/health", { host: "evil.example" });
    expect(badHost.status).toBe(403);
    expect(badHost.body.error).toContain("loopback host");
  });

  it("seeds one starter bot with its greeting", async () => {
    const { status, body } = await api("GET", "/api/bots");
    expect(status).toBe(200);
    expect(body.bots.length).toBeGreaterThanOrEqual(1);
    expect(body.bots[0].messages.length).toBeGreaterThanOrEqual(2);
  });

  it("never serializes provider resume cursors to the client", async () => {
    const listed = await api("GET", "/api/bots");
    expect(JSON.stringify(listed.body)).not.toContain("resumeCursors");
    const bot = listed.body.bots[0];

    const created = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Cursor-safe task" });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("resumeCursors");

    const renamed = await api("PATCH", `/api/bots/${bot.id}/tasks/${created.body.task.threadId}`, { title: "Renamed task" });
    expect(renamed.status).toBe(200);
    expect(JSON.stringify(renamed.body)).not.toContain("resumeCursors");

    const restored = await api("POST", `/api/bots/${bot.id}/tasks/${bot.threadId}`);
    expect(restored.status).toBe(200);
  });

  it("describes the configured fleet, shadows included", async () => {
    const { status, body } = await api("GET", "/api/instances");
    expect(status).toBe(200);
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toMatchObject({
      instanceId: "ghost",
      driverKind: "not-a-real-driver",
      displayName: "Ghost",
      snapshot: { state: "unavailable" },
    });
    expect(body.instances[0].snapshot.reason).toContain("not-a-real-driver");
  });

  it("creates, patches, and deletes a bot", async () => {
    const created = await api("POST", "/api/bots");
    expect(created.status).toBe(201);
    const bot = created.body.bot;

    const patched = await api("PATCH", `/api/bots/${bot.id}`, {
      name: "Renamed",
      pinned: true,
      voiceProfile: { voice: "bot-voice", speed: 9, gain: -20 },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.bot).toMatchObject({
      name: "Renamed",
      pinned: true,
      voiceProfile: { voice: "bot-voice", speed: 4, gain: -10 },
    });

    const missing = await api("PATCH", "/api/bots/does-not-exist", { name: "x" });
    expect(missing.status).toBe(404);

    const deleted = await api("DELETE", `/api/bots/${bot.id}`);
    expect(deleted.status).toBe(200);
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === bot.id)).toBeUndefined();
  });

  it("adds and removes room members with canonical membership validation", async () => {
    const initial = await api("GET", "/api/bots");
    const base = initial.body.bots[0];
    const created = await api("POST", "/api/bots");
    expect(created.status).toBe(201);
    const added = created.body.bot;

    const room = await api("POST", "/api/groups", {
      name: "Member editing room",
      memberIds: [base.id, added.id],
    });
    expect(room.status).toBe(201);
    const groupId = room.body.group.id;

    const deduped = await api("PATCH", `/api/groups/${groupId}`, {
      memberIds: [base.id, added.id, added.id],
    });
    expect(deduped.status).toBe(200);
    expect(deduped.body.group.memberIds).toEqual([base.id, added.id]);

    const removed = await api("PATCH", `/api/groups/${groupId}`, { memberIds: [added.id] });
    expect(removed.status).toBe(200);
    expect(removed.body.group.memberIds).toEqual([added.id]);
    expect(removed.body.group.defaultResponder).toEqual({ kind: "member", botId: added.id });

    const empty = await api("PATCH", `/api/groups/${groupId}`, { memberIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain("at least one bot");

    expect((await api("DELETE", `/api/groups/${groupId}`)).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${added.id}`)).status).toBe(200);
  });

  it("persists an answered onboarding card", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const card = bot.messages.find((m: { kind: string }) => m.kind === "options");
    const res = await api("PATCH", `/api/bots/${bot.id}/cards/${card.id}`, { answered: card.card.options[0] });
    expect(res.status).toBe(200);
    expect(res.body.message.card.answered).toBe(card.card.options[0]);
  });

  it("rejects an empty message and explains an unavailable provider", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];

    // with no runnable engine, selection stays empty instead of pointing at a
    // shadow provider that can never execute a turn
    expect(bot.modelSelection.instanceId).toBe("");

    const empty = await api("POST", `/api/bots/${bot.id}/messages`, { text: "   " });
    expect(empty.status).toBe(400);

    const invalidEffort = await api("POST", `/api/bots/${bot.id}/messages`, {
      text: "hello",
      reasoningEffort: "maximum",
    });
    expect(invalidEffort.status).toBe(400);
    expect(invalidEffort.body.error).toContain("low, medium, or high");

    // the seeded bot's selection points at the ghost instance — sending a
    // real message must fail loudly, not 202-and-hang
    const send = await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello?" });
    expect(send.status).toBe(409);
    expect(send.body.error).toContain("unavailable");
  });

  it("refuses to fork a message when the provider is unavailable, without mutating", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const before = bot.messages.length;

    // greeting is a bot message — not editable
    const greeting = bot.messages.find((m: { role: string }) => m.role === "bot");
    const notUser = await api("POST", `/api/bots/${bot.id}/messages/${greeting.id}/edit`, { text: "x" });
    expect(notUser.status).toBe(404);

    // no user message exists yet, so fabricate the check via the card id
    const card = bot.messages.find((m: { kind: string }) => m.kind === "options");
    const res = await api("POST", `/api/bots/${bot.id}/messages/${card.id}/edit`, { text: "x" });
    expect(res.status).toBe(404); // options card, not a user text message

    const empty = await api("POST", `/api/bots/${bot.id}/messages/${greeting.id}/edit`, { text: "  " });
    expect(empty.status).toBe(400);

    const after = await api("GET", "/api/bots");
    expect(after.body.bots[0].messages.length).toBe(before);
  });

  it("switches the active branch and reports the new leaf", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    expect(bot.activeLeafId).toBe(bot.messages.at(-1).id);

    // pointing at the first message descends back to the newest leaf on
    // that (only) branch — a no-op switch, but it exercises the descent
    const res = await api("POST", `/api/bots/${bot.id}/active-branch`, { messageId: bot.messages[0].id });
    expect(res.status).toBe(200);
    expect(res.body.activeLeafId).toBe(bot.messages.at(-1).id);

    const missing = await api("POST", `/api/bots/${bot.id}/active-branch`, { messageId: "nope" });
    expect(missing.status).toBe(404);
  });

  it("refuses a box token the provider rejects, at the point of pasting", async () => {
    // the stub answers 401 for anything but the good token
    const bad = await api("PUT", "/api/config", { box: { token: "box_wrong" } });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toMatch(/rejected/i);
    const after = await api("GET", "/api/config");
    expect(after.body.box).toEqual({ configured: false });
  });

  it("saves config keys write-only and reports booleans", async () => {
    const before = await api("GET", "/api/config");
    expect(before.body.box).toEqual({ configured: false });

    const put = await api("PUT", "/api/config", { box: { token: "box_good" } });
    expect(put.status).toBe(200);
    expect(put.body.box).toEqual({ configured: true });
    expect(JSON.stringify(put.body)).not.toContain("box_good");

    if (process.platform !== "win32") {
      expect(statSync(join(home, ".openmausbot", "config.json")).mode & 0o077).toBe(0);
    }

    const after = await api("GET", "/api/config");
    expect(after.body.box).toEqual({ configured: true });
    expect(JSON.stringify(after.body)).not.toContain("box_good");

    const nothing = await api("PUT", "/api/config", {});
    expect(nothing.status).toBe(400);
  });

  it("stores and echoes the user profile (not write-only, unlike keys)", async () => {
    const put = await api("PUT", "/api/config", { profile: { name: "Ada Lovelace", email: "Ada@Example.com" } });
    expect(put.status).toBe(200);
    expect(put.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });

    const after = await api("GET", "/api/config");
    expect(after.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });
  });

  it("manages a remote MCP server without returning its token", async () => {
    const created = await api("POST", "/api/mcp/servers", {
      name: "本地文档 MCP",
      url: `http://127.0.0.1:${mcpStubPort}/mcp`,
      authType: "apiKey",
      authHeader: "X-Domestic-Key",
      token: "mcp_secret",
    });
    expect(created.status).toBe(201);
    expect(created.body.server).toMatchObject({ enabled: true, authConfigured: true, authType: "apiKey" });
    expect(JSON.stringify(created.body)).not.toContain("mcp_secret");
    const id = created.body.server.id;

    const listed = await api("GET", "/api/mcp/servers");
    expect(JSON.stringify(listed.body)).not.toContain("mcp_secret");
    expect(listed.body.servers.find((server: { id: string }) => server.id === id)).toMatchObject({ name: "本地文档 MCP" });

    const tested = await api("POST", `/api/mcp/servers/${id}/test`);
    expect(tested).toMatchObject({ status: 200, body: { ok: true, tools: [{ name: "search_docs" }] } });
    expect(tested.body.server).toMatchObject({
      id,
      health: "online",
      tools: [{ name: "search_docs", description: "Search docs", allowed: true, policy: "auto" }],
    });
    expect(mcpRequests.at(-1)?.headers["x-domestic-key"]).toBe("mcp_secret");
    expect(mcpRequests.map((request) => request.body.method)).toContain("initialize");
    expect(mcpRequests.map((request) => request.body.method)).toContain("tools/list");

    const denied = await api("PATCH", `/api/mcp/servers/${id}`, { allowedTools: [] });
    expect(denied.body.server).toMatchObject({
      allowedTools: [],
      tools: [{ name: "search_docs", allowed: false, policy: "deny" }],
    });
    const persisted = await api("GET", "/api/mcp/servers");
    expect(persisted.body.servers.find((server: { id: string }) => server.id === id)).toMatchObject({ allowedTools: [] });

    const asks = await api("PATCH", `/api/mcp/servers/${id}`, { toolPolicies: { search_docs: "ask" } });
    expect(asks.body.server).toMatchObject({
      allowedTools: ["search_docs"],
      tools: [{ name: "search_docs", allowed: true, policy: "ask" }],
    });

    const bots = (await api("GET", "/api/bots")).body.bots;
    const scoped = await api("PATCH", `/api/mcp/servers/${id}`, { botIds: [bots[0].id] });
    expect(scoped.body.server.botIds).toEqual([bots[0].id]);

    const exported = await api("GET", "/api/mcp/config/export");
    expect(exported.status).toBe(200);
    expect(exported.body.servers.find((server: { id: string }) => server.id === id)).toMatchObject({
      botNames: [bots[0].name],
      authType: "apiKey",
    });
    expect(JSON.stringify(exported.body)).not.toContain("mcp_secret");

    const imported = await api("POST", "/api/mcp/config/import", exported.body);
    expect(imported).toMatchObject({ status: 200, body: { imported: 1 } });
    const retested = await api("POST", `/api/mcp/servers/${id}/test`);
    expect(retested.status).toBe(200);
    expect(mcpRequests.at(-1)?.headers["x-domestic-key"]).toBe("mcp_secret");

    const disabled = await api("PATCH", `/api/mcp/servers/${id}`, { enabled: false });
    expect(disabled.body.server.enabled).toBe(false);
    expect((await api("DELETE", `/api/mcp/servers/${id}`)).status).toBe(200);
  });

  it("returns redacted MCP audit metadata without call arguments or results", async () => {
    writeFileSync(join(home, ".openmausbot", "mcp-audit.ndjson"), `${JSON.stringify({
      id: "audit-1",
      startedAt: "2026-08-17T10:00:00.000Z",
      completedAt: "2026-08-17T10:00:00.120Z",
      durationMs: 120,
      botId: "bot-1",
      threadId: "thread-1",
      serverId: "feishu",
      tool: "search_docs",
      ok: true,
    })}\n`);
    const result = await api("GET", "/api/mcp/audit?limit=10");
    expect(result).toMatchObject({
      status: 200,
      body: { entries: [{ id: "audit-1", serverId: "feishu", tool: "search_docs", durationMs: 120, ok: true }] },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/arguments|resultBody|token|authorization/i);
  });

  it("configures a domestic provider write-only and discovers its model catalog", async () => {
    const url = `http://127.0.0.1:${voiceStubPort}/v1`;
    const put = await api("PUT", "/api/config", {
      domestic: { deepseek: { key: "domestic_secret", url } },
    });
    expect(put.status).toBe(200);
    expect(put.body.domestic.deepseek).toEqual({ configured: true });
    expect(JSON.stringify(put.body)).not.toContain("domestic_secret");

    const discovered = await api("POST", "/api/relay/deepseek/discover-models");
    expect(discovered).toMatchObject({
      status: 200,
      body: { ok: true, instanceId: "deepseek", count: 2 },
    });

    const instances = await api("GET", "/api/instances");
    const deepseek = instances.body.instances.find((instance: { instanceId: string }) => instance.instanceId === "deepseek");
    expect(deepseek).toMatchObject({
      displayName: "DeepSeek",
      snapshot: { state: "available", authenticated: true },
      models: {
        default: "deepseek-v4-flash",
        options: [
          { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
          { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
        ],
      },
      capabilities: { computerTools: true, agentTools: true, reasoningEffort: true },
    });
  });

  it("saves voice config write-only and serves STT, preparation, and TTS", async () => {
    const url = `http://127.0.0.1:${voiceStubPort}/v1`;
    const put = await api("PUT", "/api/config", {
      voice: {
        stt: { url, key: "stt_secret", model: "whisper-test", language: "zh" },
        tts: { url, key: "tts_secret", model: "tts-test", voice: "nova", provider: "openai", speed: 1.25 },
        input: {
          deviceId: "mic-test",
          profiles: {
            "mic-test": {
              sensitivity: "custom",
              minimumRms: 0.081,
              noiseRatio: 2.4,
              triggerFrames: 5,
              calibratedNoiseFloor: 0.022,
              calibratedAt: "2026-08-16T00:00:00.000Z",
            },
          },
        },
        autoSpeak: true,
      },
    });
    expect(put.status).toBe(200);
    expect(put.body.voice).toMatchObject({
      stt: { configured: true, keyConfigured: true, url, model: "whisper-test", language: "zh" },
      tts: {
        configured: true,
        keyConfigured: true,
        url,
        model: "tts-test",
        voice: "nova",
        provider: "openai",
        speed: 1.25,
        gain: 0,
        sampleRate: 44_100,
      },
      input: {
        deviceId: "mic-test",
        sensitivity: "custom",
        minimumRms: 0.081,
        noiseRatio: 2.4,
        triggerFrames: 5,
        calibratedNoiseFloor: 0.022,
      },
      autoSpeak: true,
    });
    expect(JSON.stringify(put.body)).not.toContain("stt_secret");
    expect(JSON.stringify(put.body)).not.toContain("tts_secret");

    const secondMic = await api("PATCH", "/api/config", {
      voice: {
        input: {
          deviceId: "mic-second",
          profiles: {
            "mic-second": { sensitivity: "high", minimumRms: 0.04, noiseRatio: 1.6, triggerFrames: 3 },
          },
        },
      },
    });
    expect(secondMic.status).toBe(200);
    expect(secondMic.body.voice.input.deviceId).toBe("mic-second");
    expect(secondMic.body.voice.input.profiles).toMatchObject({
      "mic-test": { sensitivity: "custom", minimumRms: 0.081 },
      "mic-second": { sensitivity: "high", minimumRms: 0.04 },
    });

    const transcript = await fetch(`${BASE}/api/voice/transcribe`, {
      method: "POST",
      headers: { "content-type": "audio/webm", "x-audio-mime": "audio/webm" },
      body: Buffer.from([1, 2, 3, 4]),
    });
    expect(transcript.status).toBe(200);
    expect(await transcript.json()).toEqual({ text: "你好，星云" });

    const prepared = await api("POST", "/api/voice/prepare", { text: "第一句。第二句。" });
    expect(prepared.status).toBe(200);
    expect(prepared.body.utterances.join("")).toBe("第一句。第二句。");

    const spoken = await fetch(`${BASE}/api/voice/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "你好" }),
    });
    expect(spoken.status).toBe(200);
    expect(spoken.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await spoken.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33, 0x04]));

    const bots = await api("GET", "/api/bots");
    const bot = bots.body.bots[0];
    await api("PATCH", `/api/bots/${bot.id}`, { voiceProfile: { voice: "coral", speed: 1.7 } });
    const botSpoken = await fetch(`${BASE}/api/voice/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "专属声音", botId: bot.id }),
    });
    expect(botSpoken.status).toBe(200);
    expect(voiceSpeechBodies.at(-1)).toMatchObject({ voice: "coral", speed: 1.7, input: "专属声音" });
  });

  it("404s unknown routes with the route in the error", async () => {
    const res = await api("GET", "/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/definitely-not-a-route");
  });
});
