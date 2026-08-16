import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { computerMcpConfig, GrokDriver } from "./grok.ts";

const FAKE_MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-computer-mcp.ts");
const FAKE_AGENTS_MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-agents-mcp.ts");

describe("OpenAI-compatible API tools", () => {
  let api: Server;
  let baseUrl = "";
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  const requests: any[] = [];
  let requestedTool = "screenshot";

  beforeEach(async () => {
    requests.length = 0;
    requestedTool = "screenshot";
    api = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const request = JSON.parse(body || "{}");
        requests.push(request);
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (requests.length === 1) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: requestedTool, arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\n`,
          );
        } else {
          res.write('data: {"choices":[{"delta":{"content":"computer "}}]}\n\n');
          res.write(
            'data: {"choices":[{"delta":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
          );
        }
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("test API did not bind");
    baseUrl = `http://127.0.0.1:${address.port}/v1`;

    instance = await GrokDriver.create({
      instanceId: "relay-test",
      displayName: "Relay Test",
      environment: {
        TEST_API_KEY: "secret",
        // A global relay setting must not replace this instance's explicit URL.
        XAI_BASE_URL: "http://127.0.0.1:1/v1",
      },
      enabled: true,
      config: {
        url: baseUrl,
        apiKeyEnv: "TEST_API_KEY",
        computerTools: true,
        agentTools: true,
        models: { default: "test-model", options: [{ id: "test-model", label: "Test" }] },
      },
    });
    recorder = recordEvents(instance.adapter);
  });

  afterEach(async () => {
    recorder?.stop();
    await instance?.dispose();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it("bridges streamed function calls to MCP and returns text plus images to the model", async () => {
    expect(instance.adapter.capabilities.computerMcp).toBe(true);
    expect(instance.adapter.capabilities.agentsMcp).toBe(true);
    await instance.adapter.sendTurn({
      threadId: "tool-thread",
      text: "look at the computer",
      model: "test-model",
      reasoningEffort: "high",
      integrations: {
        localComputer: {
          command: process.execPath,
          args: ["--experimental-strip-types", FAKE_MCP],
          env: {},
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed", 15_000);

    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.reasoning_effort === "high")).toBe(true);
    expect(requests[0].tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "screenshot" },
    });
    const replay = requests[1].messages;
    expect(replay.some((message: any) => message.role === "assistant" && message.tool_calls?.[0]?.id === "call-1")).toBe(true);
    expect(replay.some((message: any) => message.role === "tool" && message.tool_call_id === "call-1" && /called screenshot/.test(message.content))).toBe(true);
    const imageMessage = replay.find((message: any) => message.role === "user" && Array.isArray(message.content));
    expect(imageMessage.content.some((part: any) => part.type === "image_url" && /^data:image\/jpeg;base64,/.test(part.image_url.url))).toBe(true);

    expect(recorder.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.started", itemType: "tool", itemId: "call-1", title: "screenshot" }),
        expect.objectContaining({ type: "item.completed", itemType: "tool", itemId: "call-1", ok: true }),
        expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: "computer ready" }),
        expect.objectContaining({ type: "thread.token-usage.updated", input: 12, output: 3 }),
        expect.objectContaining({ type: "turn.completed", ok: true }),
      ]),
    );
    expect(instance.adapter.hasSession("tool-thread")).toBe(false);
  });

  it("mounts computer and agents MCP tools together for relay-backed chiefs", async () => {
    requestedTool = "list_bots";
    await instance.adapter.sendTurn({
      threadId: "chief-thread",
      text: "coordinate the team",
      model: "test-model",
      integrations: {
        localComputer: {
          command: process.execPath,
          args: ["--experimental-strip-types", FAKE_MCP],
          env: {},
        },
        agents: {
          command: process.execPath,
          args: ["--experimental-strip-types", FAKE_AGENTS_MCP],
          env: {},
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed", 15_000);

    expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(["screenshot", "list_bots"]);
    expect(
      requests[1].messages.some(
        (message: any) =>
          message.role === "tool" && message.tool_call_id === "call-1" && /helper-bot/.test(message.content),
      ),
    ).toBe(true);
    expect(recorder.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.started", itemType: "tool", title: "list_bots" }),
        expect.objectContaining({ type: "turn.completed", ok: true }),
      ]),
    );
  });

  it("can be configured as chat-only for endpoints without function calling", () => {
    expect(GrokDriver.decodeConfig({ computerTools: false })).toMatchObject({
      computerTools: false,
      agentTools: false,
    });
    expect(GrokDriver.decodeConfig({})).toMatchObject({ computerTools: true, agentTools: true });
    expect(GrokDriver.decodeConfig({ computerTools: false, agentTools: true })).toMatchObject({
      computerTools: false,
      agentTools: true,
    });
    expect(GrokDriver.decodeConfig({ reasoningEffort: false, url: "https://relay.example/v1/" })).toMatchObject({
      reasoningEffort: false,
      url: "https://relay.example/v1",
    });
  });

  it("uses relay-compatible cloud screenshots without changing local computer integrations", () => {
    expect(
      computerMcpConfig({
        threadId: "cloud-screen",
        text: "look",
        integrations: { computer: { boxId: "box-1", token: "token" } },
      })?.env?.OGB_SHOT_WIDTH,
    ).toBe("512");

    const local = { command: "cua", args: ["serve"], env: { CUA_MODE: "local" } };
    expect(
      computerMcpConfig({
        threadId: "local-screen",
        text: "look",
        integrations: { localComputer: local },
      }),
    ).toEqual(local);
  });
});
