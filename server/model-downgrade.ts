import type { ModelCatalog } from "./contracts.ts";
import type { ReasoningLevel } from "./reasoning.ts";

type ModelVendor = "openai" | "anthropic" | "xai" | "google" | "deepseek" | "glm" | "qwen" | "kimi";
type RankedModel = { id: string; vendor: ModelVendor; score: number };

const NON_CHAT_MODEL = /(?:^|[-_\s/.])(image|images|embedding|embeddings|audio|tts|whisper|speech|rerank|moderation|auto[-_]?review)(?:$|[-_\s/.])/i;

function vendorFor(text: string): ModelVendor | undefined {
  const value = text.toLowerCase();
  if (/claude|anthropic/.test(value)) return "anthropic";
  if (/deepseek/.test(value)) return "deepseek";
  if (/(?:^|[/_.-])glm(?:$|[/_.-])|zhipu|thudm/.test(value)) return "glm";
  if (/qwen|dashscope|tongyi/.test(value)) return "qwen";
  if (/kimi|moonshot/.test(value)) return "kimi";
  if (/gemini|google/.test(value)) return "google";
  if (/grok|xai/.test(value)) return "xai";
  if (/(?:^|[/_.-])gpt(?:$|[/_.-])|(?:^|[/_.-])o[1-9](?:$|[/_.-])|openai|codex/.test(value)) return "openai";
  return undefined;
}

function versionScore(text: string): number {
  const matches = [...text.matchAll(/\d+(?:[.-]\d+)*/g)];
  if (!matches.length) return 0;
  const parts = matches[0][0].split(/[.-]/).slice(0, 3).map(Number);
  return (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 10_000 + (parts[2] ?? 0) * 100;
}

function parameterScore(text: string): number {
  const match = text.match(/(?:^|[-_\s/])(\d+(?:\.\d+)?)b(?:$|[-_\s/])/i);
  return match ? Math.round(Number(match[1]) * 10) : 0;
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function vendorScore(vendor: ModelVendor, text: string): number {
  const version = versionScore(text);
  const params = parameterScore(text);
  switch (vendor) {
    case "openai": {
      const tier = text.includes("sol") ? 90 : text.includes("terra") ? 80 : text.includes("mini") ? 40 : text.includes("nano") ? 20 : 70;
      return version * 1_000 + tier + params;
    }
    case "anthropic": {
      const tier = text.includes("opus") ? 400 : text.includes("fable") ? 300 : text.includes("sonnet") ? 200 : text.includes("haiku") ? 100 : 50;
      return tier * 1_000_000_000 + version * 1_000 + params;
    }
    case "xai": {
      const tier = text.includes("mini") ? 10 : text.includes("fast") ? 20 : 30;
      return version * 1_000 + tier + params;
    }
    case "google": {
      const tier = text.includes("ultra") ? 400 : text.includes("pro") ? 300 : text.includes("flash") ? 200 : text.includes("nano") ? 100 : 50;
      return tier * 1_000_000_000 + version * 1_000 + params;
    }
    case "deepseek": {
      const tier = text.includes("pro") ? 300 : text.includes("flash") ? 100 : includesAny(text, ["lite", "distill"]) ? 50 : 200;
      return tier * 1_000_000_000 + version * 1_000 + params;
    }
    case "glm": {
      const tier = text.includes("flash") ? 100 : includesAny(text, ["air", "lite"]) ? 200 : 300;
      return version * 1_000 + tier + params;
    }
    case "qwen": {
      const tier = text.includes("max") ? 400 : text.includes("plus") ? 300 : text.includes("turbo") ? 200 : includesAny(text, ["flash", "lite"]) ? 100 : 250;
      return version * 1_000 + tier + params;
    }
    case "kimi": {
      const tier = text.includes("turbo") ? 200 : includesAny(text, ["lite", "mini"]) ? 100 : 300;
      return version * 1_000 + tier + params;
    }
  }
}

function rankModel(id: string, label = id): RankedModel | undefined {
  const text = `${id} ${label}`.toLowerCase();
  if (NON_CHAT_MODEL.test(text)) return undefined;
  const vendor = vendorFor(text);
  if (!vendor) return undefined;
  return { id, vendor, score: vendorScore(vendor, text) };
}

/** Return the closest strictly lower chat model from the same provider
 * catalog. The catalog order is intentionally ignored because discovered
 * relay catalogs are not consistently sorted. */
export function lowerModelInCatalog(catalog: ModelCatalog, currentModel: string): string | undefined {
  const currentOption = catalog.options.find((option) => option.id === currentModel);
  const current = rankModel(currentModel, currentOption?.label);
  if (!current) return undefined;

  const candidates = catalog.options
    .map((option) => rankModel(option.id, option.label))
    .filter((candidate): candidate is RankedModel =>
      Boolean(candidate) && candidate!.id !== currentModel && candidate!.vendor === current.vendor && candidate!.score < current.score,
    )
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return candidates[0]?.id;
}

export function modelForReasoningLevel(
  catalog: ModelCatalog,
  currentModel: string,
  level: ReasoningLevel | undefined,
): string {
  return level === "minimal" ? (lowerModelInCatalog(catalog, currentModel) ?? currentModel) : currentModel;
}
