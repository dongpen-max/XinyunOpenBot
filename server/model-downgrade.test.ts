import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "./contracts.ts";
import { lowerModelInCatalog, modelForReasoningLevel } from "./model-downgrade.ts";

const catalog = (ids: string[]): ModelCatalog => ({
  default: ids[0] ?? "",
  options: ids.map((id) => ({ id, label: id })),
});

describe("lowest reasoning model downgrade", () => {
  it("chooses the closest lower OpenAI model independent of catalog order", () => {
    const models = catalog([
      "gpt-5.4-mini",
      "gpt-image-2",
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.4",
    ]);
    expect(lowerModelInCatalog(models, "gpt-5.6-sol")).toBe("gpt-5.5");
    expect(lowerModelInCatalog(models, "gpt-5.5")).toBe("gpt-5.4");
    expect(lowerModelInCatalog(models, "gpt-5.4")).toBe("gpt-5.4-mini");
    expect(lowerModelInCatalog(models, "gpt-5.4-mini")).toBeUndefined();
  });

  it("stays within the current vendor and respects provider-specific tiers", () => {
    const models = catalog([
      "gpt-5.5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-fable-5",
    ]);
    expect(lowerModelInCatalog(models, "claude-opus-5")).toBe("claude-opus-4-8");
    expect(lowerModelInCatalog(models, "claude-fable-5")).toBe("claude-sonnet-5");
  });

  it("supports domestic model tiers and falls back safely", () => {
    const models = catalog([
      "deepseek-v3.2-flash",
      "deepseek-v3.2-pro",
      "deepseek-v3.2",
      "BAAI/bge-large-zh-v1.5",
    ]);
    expect(lowerModelInCatalog(models, "deepseek-v3.2-pro")).toBe("deepseek-v3.2");
    expect(lowerModelInCatalog(models, "deepseek-v3.2")).toBe("deepseek-v3.2-flash");
    expect(modelForReasoningLevel(models, "deepseek-v3.2-pro", "minimal")).toBe("deepseek-v3.2");
    expect(modelForReasoningLevel(models, "deepseek-v3.2-pro", "maximum")).toBe("deepseek-v3.2-pro");
    expect(modelForReasoningLevel(models, "unknown-model", "minimal")).toBe("unknown-model");
  });
});
