import type { ReasoningEffort } from "./contracts.ts";

const VALUES = new Set<ReasoningEffort>(["low", "medium", "high"]);
const LEVELS = new Set<ReasoningLevel>(["minimal", "low", "medium", "high", "maximum"]);

export type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "maximum";

export function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && VALUES.has(value as ReasoningEffort)) return value as ReasoningEffort;
  throw Object.assign(new Error("reasoningEffort must be low, medium, or high"), { status: 400 });
}

export function parseReasoningLevel(value: unknown): ReasoningLevel | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && LEVELS.has(value as ReasoningLevel)) return value as ReasoningLevel;
  throw Object.assign(
    new Error("reasoningLevel must be minimal, low, medium, high, or maximum"),
    { status: 400 },
  );
}

/** New clients send five UI levels; older clients sent the provider's three
 * wire values. Prefer the new field when present and keep the old route
 * contract working during upgrades. */
export function parseReasoningRequest(level: unknown, legacyEffort: unknown): ReasoningLevel | undefined {
  if (level !== undefined && level !== null && level !== "") return parseReasoningLevel(level);
  return parseReasoningEffort(legacyEffort);
}

export function reasoningEffortForLevel(level: ReasoningLevel | undefined): ReasoningEffort | undefined {
  if (level === "minimal" || level === "low") return "low";
  if (level === "medium") return "medium";
  if (level === "high" || level === "maximum") return "high";
  return undefined;
}
