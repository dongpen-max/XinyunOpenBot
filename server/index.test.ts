// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. The config pins one deliberately-unknown driver so the
// suite is deterministic with or without agent CLIs installed — and pins
// the shadow-instance behavior end to end while it's at it.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  await new Promise<void>((r) => voiceStub.listen(0, "127.0.0.1", r));
  voiceStubPort = (voiceStub.address() as { port: number }).port;

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

  it("seeds one starter bot with its greeting", async () => {
    const { status, body } = await api("GET", "/api/bots");
    expect(status).toBe(200);
    expect(body.bots.length).toBeGreaterThanOrEqual(1);
    expect(body.bots[0].messages.length).toBeGreaterThanOrEqual(2);
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
