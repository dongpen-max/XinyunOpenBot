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
});
