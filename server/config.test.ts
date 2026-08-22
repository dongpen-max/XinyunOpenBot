// instanceConfigs merge contract: custom instances layer ONTO the default
// fleet instead of replacing it, so adding a relay can never silently drop
// Claude or the cloud computer.
import { describe, expect, it } from "vitest";

import { instanceConfigs } from "./config.ts";

const DEFAULT_IDS = ["grok", "kimi", "claude", "codex", "antigravity", "computer"];

describe("instanceConfigs", () => {
  it("returns the whole default fleet when no instances are configured", () => {
    expect(Object.keys(instanceConfigs({}))).toEqual(DEFAULT_IDS);
  });

  it("keeps every default when a custom instance is added", () => {
    const map = instanceConfigs({
      instances: { relay: { driver: "grok", displayName: "Relay" } },
    });
    for (const id of DEFAULT_IDS) expect(map[id]).toBeDefined();
    expect(map.relay?.displayName).toBe("Relay");
    expect(map.computer?.driver).toBe("boxAgent");
  });

  it("uses the 心云 brand for legacy 星云 relay labels", () => {
    expect(instanceConfigs({ instances: { relay: { driver: "grok", displayName: "星云 Gemini" } } }).relay?.displayName)
      .toBe("心云 Gemini");
  });

  it("merges into a default entry rather than clobbering its driver", () => {
    const map = instanceConfigs({
      instances: { claude: { config: { url: "https://relay.example/v1" } } as never },
    });
    expect(map.claude?.driver).toBe("claudeAgent");
    expect(map.claude?.config).toEqual({ url: "https://relay.example/v1" });
  });

  it("drops an instance marked enabled:false", () => {
    const map = instanceConfigs({ instances: { codex: { driver: "codex", enabled: false } } });
    expect(map.codex).toBeUndefined();
    expect(map.claude).toBeDefined();
  });

  it("does not leak per-call environment into the shared default fleet", () => {
    const first = instanceConfigs({ xai: { key: "xai-first" } });
    const second = instanceConfigs({});
    expect(first.claude?.environment?.XAI_API_KEY).toBe("xai-first");
    expect(second.claude?.environment?.XAI_API_KEY).toBeUndefined();
  });

  it("adds configured domestic OpenAI-compatible providers without changing the default fleet", () => {
    const map = instanceConfigs({
      domestic: {
        deepseek: { key: "deepseek-secret" },
        zhipu: { key: "glm-secret", url: "https://glm.example/v4/" },
      },
    });

    for (const id of DEFAULT_IDS) expect(map[id]).toBeDefined();
    expect(map.deepseek).toMatchObject({
      driver: "grok",
      displayName: "DeepSeek",
      environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
      config: {
        url: "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        reasoningEffort: true,
        computerTools: true,
        agentTools: true,
      },
    });
    expect(map.zhipu).toMatchObject({
      driver: "grok",
      displayName: "智谱 GLM",
      environment: { ZHIPU_API_KEY: "glm-secret" },
      config: { url: "https://glm.example/v4", reasoningEffort: true },
    });
    expect(map.dashscope).toBeUndefined();
    expect(map.moonshot).toBeUndefined();
  });

  it("adds a Google Gemini-compatible relay when configured", () => {
    const map = instanceConfigs({ gemini: { key: "gemini-secret" } });
    expect(map.geminiApi).toMatchObject({
      driver: "grok",
      displayName: "心云 Gemini (Google)",
      environment: { GEMINI_API_KEY: "gemini-secret" },
      config: {
        url: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKeyEnv: "GEMINI_API_KEY",
        reasoningEffort: false,
      },
    });
  });

  it("lets an explicit instance override a domestic preset", () => {
    const map = instanceConfigs({
      domestic: { deepseek: { key: "deepseek-secret" } },
      instances: { deepseek: { driver: "grok", displayName: "自定义 DeepSeek", config: { url: "https://relay.example/v1" } } },
    });
    expect(map.deepseek?.displayName).toBe("自定义 DeepSeek");
    expect(map.deepseek?.config).toMatchObject({
      url: "https://relay.example/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      reasoningEffort: true,
      computerTools: true,
      agentTools: true,
    });
  });
});
