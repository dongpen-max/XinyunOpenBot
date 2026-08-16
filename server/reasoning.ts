import type { ReasoningEffort } from "./contracts.ts";

const VALUES = new Set<ReasoningEffort>(["low", "medium", "high"]);

export function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && VALUES.has(value as ReasoningEffort)) return value as ReasoningEffort;
  throw Object.assign(new Error("reasoningEffort must be low, medium, or high"), { status: 400 });
}
