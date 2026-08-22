// ACP driver contract tests, run against the scripted fake ACP CLI in
// server/testing/fake-acp-cli.ts. Covers the shared acp/core.ts runtime and
// OpenCode's native model configuration, while keeping argv/env hygiene,
// permission asks, and interrupt/crash settlement covered.
//
// Spawn-based tests are POSIX-only until Windows CLI spawning lands (the fake
// CLI is a shebang script Windows cannot exec directly).
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs, type AppConfig } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { resolveManagedMcpTool } from "../../mcp.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { GrokAgentDriver } from "./grok.ts";
import { GeminiAgentDriver } from "./gemini.ts";
import { normalizeOpenCodeMcpTool, OpenCodeAgentDriver, parseOpenCodeModels } from "./opencode.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

describe("ACP decodeConfig", () => {
  it("grok defaults to the grok binary", () => {
    expect(GrokAgentDriver.decodeConfig({})).toEqual({ cli: "grok", fullAuto: false, workspace: undefined });
  });
  it("gemini defaults to the gemini binary", () => {
    expect(GeminiAgentDriver.decodeConfig(undefined)).toEqual({ cli: "gemini", fullAuto: false, workspace: undefined });
  });
  it("opencode defaults to the opencode binary", () => {
    expect(OpenCodeAgentDriver.decodeConfig({})).toEqual({ cli: "opencode", fullAuto: false, workspace: undefined });
  });
  it("parses OpenCode's provider/model catalogue without hard-coded providers", () => {
    expect(parseOpenCodeModels("\u001b[32mopenai/gpt-5.6\u001b[0m\nlocal/my-model\ngoogle/gemini-embedding-001\nnot a model\nopenai/gpt-5.6\n")).toEqual({
      default: "openai/gpt-5.6",
      options: [
        { id: "openai/gpt-5.6", label: "openai/gpt-5.6" },
        { id: "local/my-model", label: "local/my-model" },
      ],
    });
  });
  it("maps an OpenCode MCP name that survives sanitization", () => {
    expect(normalizeOpenCodeMcpTool("configured_search_docs", [{
      id: "configured",
      url: "https://mcp.example.test/server",
      allowedTools: ["search_docs"],
    }])).toEqual({ name: "mcp__configured__search_docs", resolution: "resolved" });
  });
  it("maps punctuation in an OpenCode MCP name back to the original tool", () => {
    expect(normalizeOpenCodeMcpTool("configured_write_docs_v2", [{
      id: "configured",
      url: "https://mcp.example.test/server",
      allowedTools: ["write.docs.v2"],
    }])).toEqual({ name: "mcp__configured__write.docs.v2", resolution: "resolved" });
  });
  it("marks colliding OpenCode MCP names ambiguous", () => {
    expect(normalizeOpenCodeMcpTool("configured_write_docs", [{
      id: "configured",
      url: "https://mcp.example.test/server",
      allowedTools: ["write.docs", "write_docs"],
    }])).toEqual({ name: "configured_write_docs", resolution: "ambiguous" });
  });
  it("fullAuto only when explicitly true", () => {
    expect(GrokAgentDriver.decodeConfig({ fullAuto: "yes" }).fullAuto).toBe(false);
    expect(GrokAgentDriver.decodeConfig({ fullAuto: true }).fullAuto).toBe(true);
  });
});

posixOnly("ACP turns (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (driver = GrokAgentDriver, mode?: string, authMethod?: string) => {
    if (mode) process.env.FAKE_ACP_MODE = mode;
    if (authMethod) process.env.FAKE_ACP_AUTH_METHOD = authMethod;
    instance = await driver.create({
      instanceId: "acp-test",
      displayName: "ACP Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-acp-test-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_ACP_MODE;
    delete process.env.FAKE_ACP_DUMP;
    delete process.env.FAKE_ACP_RPC_DUMP;
    delete process.env.FAKE_ACP_AUTH_METHOD;
    delete process.env.FAKE_ACP_AUTH_STATUS;
    delete process.env.FAKE_ACP_TOOL_NAME;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    recorder?.stop();
    await instance?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("discovers OpenCode models from the installed CLI output", async () => {
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    expect(instance.models).toEqual({
      default: "opencode/big-pickle",
      options: [
        { id: "opencode/big-pickle", label: "opencode/big-pickle" },
        { id: "local/custom-model", label: "local/custom-model" },
        { id: "provider/model/with-slash", label: "provider/model/with-slash" },
      ],
    });
  });

  it("keeps OpenCode loadable when model discovery fails", async () => {
    await create(OpenCodeAgentDriver, "model-discovery-failure", "opencode-login");
    expect(instance.models).toEqual({ default: "", options: [] });
    await expect(instance.snapshot()).resolves.toMatchObject({
      state: "unavailable",
      reason: "OpenCode model discovery failed",
    });
    await expect(instance.adapter.sendTurn({ threadId: "t-opencode-no-models", text: "go" })).rejects.toThrow(
      "OpenCode model discovery failed",
    );
  });

  it("starts OpenCode with the opencode acp arguments", async () => {
    const dump = join(scratch, "opencode-argv.json");
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    process.env.FAKE_ACP_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-opencode-argv", text: "go", model: "local/custom-model" });
    await recorder.until((e) => e.type === "turn.completed" && e.threadId === "t-opencode-argv");

    expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual(["acp"]);
  });

  it("does not inherit Xinyun provider credentials, but keeps explicit OpenCode env", async () => {
    const dump = join(scratch, "opencode-env.json");
    process.env.OPENAI_API_KEY = "ambient-openai-secret";
    process.env.ANTHROPIC_API_KEY = "ambient-anthropic-secret";
    process.env.OPENCODE_API_KEY = "opencode-provider-secret";
    process.env.FAKE_ACP_DUMP = dump;
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    await instance.adapter.sendTurn({
      threadId: "t-opencode-env",
      text: "go",
      model: "local/custom-model",
    });
    await recorder.until((e) => e.type === "turn.completed" && e.threadId === "t-opencode-env");

    const env = JSON.parse(readFileSync(dump, "utf8")).env;
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENCODE_API_KEY).toBe("opencode-provider-secret");

    await instance.dispose();
    const explicitDump = join(scratch, "opencode-explicit-env.json");
    process.env.FAKE_ACP_DUMP = explicitDump;
    instance = await OpenCodeAgentDriver.create({
      instanceId: "acp-test-explicit-env",
      displayName: "ACP Test",
      environment: { OPENAI_API_KEY: "explicit-openai-secret" },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    const explicitRecorder = recordEvents(instance.adapter);
    await instance.adapter.sendTurn({ threadId: "t-opencode-explicit-env", text: "go", model: "local/custom-model" });
    await explicitRecorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(explicitDump, "utf8")).env.OPENAI_API_KEY).toBe("explicit-openai-secret");
    explicitRecorder.stop();
  });

  it("applies the selected model after session/new and before session/prompt", async () => {
    const dump = join(scratch, "opencode-rpc.json");
    process.env.FAKE_ACP_RPC_DUMP = dump;
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    await instance.adapter.sendTurn({ threadId: "t-opencode-model", text: "go", model: "local/custom-model" });
    await recorder.until((e) => e.type === "turn.completed");

    const messages = JSON.parse(readFileSync(dump, "utf8"));
    expect(messages.map((message: any) => message.method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(messages[3].params).toEqual({
      sessionId: "fake-acp-session",
      configId: "model",
      value: "local/custom-model",
    });
    expect(recorder.events.find((event) => event.type === "session.started")).toMatchObject({
      model: "local/custom-model",
    });
    expect(recorder.events.find((event) => event.type === "thread.token-usage.updated")).toMatchObject({
      input: 10,
      output: 5,
    });
  });

  it("applies the selected model after session/load", async () => {
    const dump = join(scratch, "opencode-load-rpc.json");
    process.env.FAKE_ACP_RPC_DUMP = dump;
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    await instance.adapter.sendTurn({
      threadId: "t-opencode-load",
      text: "go",
      model: "local/custom-model",
      resumeCursor: "previous-session",
    });
    await recorder.until((e) => e.type === "turn.completed");

    const messages = JSON.parse(readFileSync(dump, "utf8"));
    expect(messages.map((message: any) => message.method)).toEqual([
      "initialize",
      "authenticate",
      "session/load",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(messages[3].params.sessionId).toBe("previous-session");
  });

  it("fails the turn when OpenCode rejects the selected model", async () => {
    const dump = join(scratch, "opencode-model-failure.json");
    process.env.FAKE_ACP_RPC_DUMP = dump;
    await create(OpenCodeAgentDriver, "model-failure", "opencode-login");
    await instance.adapter.sendTurn({ threadId: "t-opencode-model-failure", text: "go", model: "local/custom-model" });
    const done = await recorder.until((e) => e.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "rpc_error" });
    expect(recorder.events.find((e) => e.type === "runtime.error")?.message).toMatch(/model rejected/);
    expect(JSON.parse(readFileSync(dump, "utf8")).map((message: any) => message.method)).not.toContain("session/prompt");
  });

  it("passes the shared MCP integrations through OpenCode session/new", async () => {
    const dump = join(scratch, "opencode-mcp.json");
    process.env.FAKE_ACP_RPC_DUMP = dump;
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    await instance.adapter.sendTurn({
      threadId: "t-opencode-mcp",
      text: "go",
      model: "local/custom-model",
      integrations: {
        agents: { command: "agents-proxy", args: ["mcp"], env: { PEER_TOKEN: "peer" } },
        computer: { boxId: "box-1", token: "box-token" },
        mcp: [{ id: "configured", url: "https://mcp.example.test/server" }],
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const messages = JSON.parse(readFileSync(dump, "utf8"));
    const session = messages.find((message: any) => message.method === "session/new");
    expect(session.params.mcpServers.map((server: any) => server.name)).toEqual(["agents", "computer", "configured"]);
    expect(session.params.mcpServers.find((server: any) => server.name === "agents")).toMatchObject({
      command: "agents-proxy",
      args: ["mcp"],
      env: [{ name: "PEER_TOKEN", value: "peer" }],
    });
  });

  it("restores OpenCode MCP activity to the original server and tool", async () => {
    process.env.FAKE_ACP_TOOL_NAME = "configured_search_docs";
    await create(OpenCodeAgentDriver, undefined, "opencode-login");
    await instance.adapter.sendTurn({
      threadId: "t-opencode-mcp-activity",
      text: "go",
      model: "local/custom-model",
      integrations: {
        mcp: [{ id: "configured", url: "https://mcp.example.test/server", allowedTools: ["search_docs"] }],
      },
    });
    const started = await recorder.until((event) => event.type === "item.started");
    if (started.type !== "item.started") throw new Error("expected an item.started event");
    expect(started).toMatchObject({
      title: "mcp__configured__search_docs",
      mcpToolResolution: "resolved",
    });
    const cfg: AppConfig = {
      mcp: {
        servers: {
          configured: {
            name: "Configured",
            url: "https://mcp.example.test/server",
            tools: [{ name: "search_docs" }],
            toolPolicies: { search_docs: "auto" },
          },
        },
      },
    };
    expect(resolveManagedMcpTool(cfg, started.title)).toEqual({ serverId: "configured", tool: "search_docs" });
    await recorder.until((event) => event.type === "turn.completed");
  });

  it("restores OpenCode MCP permission names before the shared policy broker", async () => {
    process.env.FAKE_ACP_TOOL_NAME = "configured_write_docs_v2";
    await create(OpenCodeAgentDriver, "permission", "opencode-login");
    await instance.adapter.sendTurn({
      threadId: "t-opencode-mcp-permission",
      text: "go",
      model: "local/custom-model",
      integrations: {
        mcp: [{
          id: "configured",
          url: "https://mcp.example.test/server",
          allowedTools: ["write.docs.v2"],
          toolPolicies: { "write.docs.v2": "ask" },
        }],
      },
    });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(opened).toMatchObject({
      tool: "mcp__configured__write.docs.v2",
      mcpToolResolution: "resolved",
    });
    await instance.adapter.respondToRequest("t-opencode-mcp-permission", (opened as any).requestId, { behavior: "deny" });
    await recorder.until((event) => event.type === "turn.completed");
  });

  it("normalizes a full turn into the canonical event sequence", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-happy", text: "hi", model: "grok-4.5" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.started", // tool tc-1
      "item.completed", // tool tc-1 done
      "thread.token-usage.updated",
      "item.completed", // assistant_text (summed) on settle
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "grokAgent")).toBe(true);
    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated")!;
    expect(usage).toMatchObject({ input: 10, output: 5 });
    const text = recorder.events.find((e) => e.type === "item.completed" && (e as any).itemType === "assistant_text")!;
    expect((text as any).text).toBe("hello from fake acp");
    const done = recorder.events.at(-1)!;
    expect(done).toMatchObject({ type: "turn.completed", ok: true });
    expect(instance.adapter.hasSession("t-happy")).toBe(false);
  });

  it("passes ACP stdio flags and strips XAI_API_KEY from the child env", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.XAI_API_KEY = "xai-should-not-leak";

    await instance.adapter.sendTurn({ threadId: "t-hygiene", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("agent");
    expect(seen.argv).toContain("stdio");
    expect(seen.argv).toContain("--permission-mode");
    expect(seen.env.XAI_API_KEY).toBeUndefined();
  });

  it("surfaces a permission ask as request.opened and completes once allowed", async () => {
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-perm", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    if (opened.type !== "request.opened") throw new Error("expected a request.opened event");
    expect(opened).toMatchObject({ requestType: "permission", tool: "shell" });
    expect(opened.mcpToolResolution).toBeUndefined();

    await instance.adapter.respondToRequest("t-perm", (opened as any).requestId, { behavior: "allow" });
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "allow", source: "user" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("routes OpenCode permission requests through the shared broker", async () => {
    await create(OpenCodeAgentDriver, "permission", "opencode-login");
    await instance.adapter.sendTurn({ threadId: "t-opencode-perm", text: "go", model: "local/custom-model" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "permission", tool: "shell" });

    await instance.adapter.respondToRequest("t-opencode-perm", (opened as any).requestId, { behavior: "allow" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("grok fails closed when the CLI advertises no cached_token (needs login)", async () => {
    await create(GrokAgentDriver, "no-auth");
    await instance.adapter.sendTurn({ threadId: "t-auth", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "auth_required" });
    const err = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(err.message).toMatch(/not signed in/);
  });

  it("gemini proceeds through a missing auth method (lenient login)", async () => {
    await create(GeminiAgentDriver, "no-auth");
    await instance.adapter.sendTurn({ threadId: "t-lenient", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.some((e) => e.provider === "geminiAgent")).toBe(true);
  });

  it("rejects a second turn while one is in flight", async () => {
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-busy", text: "one" });
    await recorder.until((e) => e.type === "session.started");
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "two" })).rejects.toThrow(/already running/);
    await instance.adapter.interruptTurn("t-busy");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("interrupt settles a hung turn as cancelled", async () => {
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-int", text: "go" });
    await recorder.until((e) => e.type === "session.started");
    await instance.adapter.interruptTurn("t-int");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ type: "turn.completed" });
  });

  it("an exit before result becomes runtime.error + failed turn", async () => {
    await create(GrokAgentDriver, "exit-early");
    await instance.adapter.sendTurn({ threadId: "t-crash", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false });
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("ACP snapshot", () => {
  it("a missing binary is unavailable", async () => {
    const instance = await GrokAgentDriver.create({
      instanceId: "grok-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: "definitely-not-a-real-grok-binary", fullAuto: false },
    });
    const snap = await instance.snapshot();
    expect(snap.state).toBe("unavailable");
    await instance.dispose();
  });
});

describe.skipIf(process.platform === "win32")("OpenCode snapshot", () => {
  it("reports authentication using OpenCode's auth list", async () => {
    process.env.FAKE_ACP_AUTH_STATUS = "none";
    chmodSync(FAKE_CLI, 0o755);
    const instance = await OpenCodeAgentDriver.create({
      instanceId: "opencode-auth",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    const snapshot = await instance.snapshot();
    expect(snapshot).toMatchObject({ state: "available", authenticated: false });
    await instance.dispose();
  });
});

describe("OpenCode missing CLI snapshot", () => {
  it("reports a missing OpenCode CLI as unavailable", async () => {
    const instance = await OpenCodeAgentDriver.create({
      instanceId: "opencode-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: "definitely-not-a-real-opencode-binary", fullAuto: false },
    });
    const snapshot = await instance.snapshot();
    expect(snapshot).toMatchObject({ state: "unavailable" });
    expect(snapshot.reason).toContain("CLI not found");
    await instance.dispose();
  });
});
