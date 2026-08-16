import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../config.ts";
import { describeVoice, synthesize, transcribe, VoiceConfigError } from "./index.ts";

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void | Promise<void>,
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        await handler(req, res, Buffer.concat(chunks));
        if (!res.writableEnded) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ text: "你好，星云" }));
        }
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}/v1`;
}

describe("voice provider", () => {
  it("describes defaults without exposing keys", () => {
    const status = describeVoice({
      voice: {
        stt: { key: "stt_secret", url: "http://voice.test/v1" },
        tts: { key: "tts_secret", url: "http://voice.test/v1" },
        autoSpeak: true,
      },
    });
    expect(status).toEqual({
      stt: {
        configured: true,
        keyConfigured: true,
        url: "http://voice.test/v1",
        model: "whisper-1",
        language: "zh",
      },
      tts: {
        configured: true,
        keyConfigured: true,
        url: "http://voice.test/v1",
        model: "tts-1",
        voice: "alloy",
        provider: "openai",
        speed: 1,
        gain: 0,
        sampleRate: 44_100,
      },
      input: {
        deviceId: "default",
        sensitivity: "medium",
        minimumRms: 0.055,
        noiseRatio: 1.9,
        triggerFrames: 4,
        profiles: {
          default: {
            sensitivity: "medium",
            minimumRms: 0.055,
            noiseRatio: 1.9,
            triggerFrames: 4,
          },
        },
      },
      autoSpeak: true,
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("posts browser audio to an OpenAI-compatible transcription endpoint", async () => {
    const url = await listen((req, _res, body) => {
      expect(req.url).toBe("/v1/audio/transcriptions");
      expect(req.headers.authorization).toBe("Bearer stt_secret");
      expect(req.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      expect(body.toString("utf8")).toContain('name="model"');
      expect(body.toString("utf8")).toContain("whisper-zh");
      expect(body.toString("utf8")).toContain('filename="recording.webm"');
    });
    const cfg: AppConfig = {
      voice: { stt: { key: "stt_secret", url, model: "whisper-zh", language: "zh" } },
    };

    await expect(transcribe(cfg, new Uint8Array([1, 2, 3]), "audio/webm")).resolves.toBe("你好，星云");
  });

  it("posts text to an OpenAI-compatible speech endpoint", async () => {
    const url = await listen((req, res, body) => {
      expect(req.url).toBe("/v1/audio/speech");
      expect(req.headers.authorization).toBe("Bearer tts_secret");
      expect(JSON.parse(body.toString("utf8"))).toEqual({
        model: "tts-cn",
        voice: "xiaoyun",
        input: "任务完成",
        response_format: "mp3",
        speed: 1,
      });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from([9, 8, 7]));
    });
    const cfg: AppConfig = {
      voice: { tts: { key: "tts_secret", url, model: "tts-cn", voice: "xiaoyun" } },
    };

    const audio = await synthesize(cfg, "任务完成");
    expect([...audio.bytes]).toEqual([9, 8, 7]);
    expect(audio.mime).toBe("audio/mpeg");
  });

  it("sends SiliconFlow-only tuning parameters and clamps unsafe values", async () => {
    const url = await listen((req, res, body) => {
      expect(req.url).toBe("/v1/audio/speech");
      expect(JSON.parse(body.toString("utf8"))).toEqual({
        model: "FunAudioLLM/CosyVoice2-0.5B",
        voice: "FunAudioLLM/CosyVoice2-0.5B:anna",
        input: "试听声音",
        response_format: "mp3",
        speed: 4,
        gain: -10,
        sample_rate: 48_000,
      });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from([1]));
    });
    const cfg: AppConfig = {
      voice: {
        tts: {
          url,
          provider: "siliconflow",
          model: "FunAudioLLM/CosyVoice2-0.5B",
          voice: "FunAudioLLM/CosyVoice2-0.5B:anna",
          speed: 9,
          gain: -50,
          sampleRate: 96_000,
        },
      },
    };

    await expect(synthesize(cfg, "试听声音")).resolves.toMatchObject({ mime: "audio/mpeg" });
  });

  it("applies per-bot tuning without changing the shared provider config", async () => {
    const url = await listen((_req, res, body) => {
      expect(JSON.parse(body.toString("utf8"))).toMatchObject({
        voice: "FunAudioLLM/CosyVoice2-0.5B:diana",
        speed: 1.65,
        gain: 3,
      });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from([1]));
    });
    const cfg: AppConfig = {
      voice: {
        tts: {
          url,
          provider: "siliconflow",
          model: "FunAudioLLM/CosyVoice2-0.5B",
          voice: "FunAudioLLM/CosyVoice2-0.5B:anna",
          speed: 1,
          gain: 0,
        },
      },
    };

    await synthesize(cfg, "机器人发言", {
      voice: "FunAudioLLM/CosyVoice2-0.5B:diana",
      speed: 1.65,
      gain: 3,
    });
    expect(describeVoice(cfg).tts).toMatchObject({ voice: "FunAudioLLM/CosyVoice2-0.5B:anna", speed: 1, gain: 0 });
  });

  it("requires configured endpoints before using voice", async () => {
    await expect(transcribe({}, new Uint8Array([1]))).rejects.toBeInstanceOf(VoiceConfigError);
    await expect(synthesize({}, "hello")).rejects.toBeInstanceOf(VoiceConfigError);
  });

  it("sanitizes per-device microphone activity profiles", () => {
    const status = describeVoice({
      voice: {
        input: {
          deviceId: "usb-mic",
          profiles: {
            "usb-mic": {
              sensitivity: "custom",
              minimumRms: 9,
              noiseRatio: 0,
              triggerFrames: 99,
              calibratedNoiseFloor: 0.021,
            },
          },
        },
      },
    }).input;
    expect(status).toMatchObject({
      deviceId: "usb-mic",
      sensitivity: "custom",
      minimumRms: 0.2,
      noiseRatio: 1.1,
      triggerFrames: 12,
      calibratedNoiseFloor: 0.021,
    });
    expect(status.profiles["usb-mic"]).toEqual(expect.objectContaining({ sensitivity: "custom" }));
  });
});
