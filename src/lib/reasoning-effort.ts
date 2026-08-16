import type { ReasoningLevel } from "./drafts.js";

export const REASONING_LEVELS = [
  { value: "minimal", label: "极低", description: "降低一级模型并使用较低思考强度" },
  { value: "low", label: "低", description: "响应更快，适合简单任务" },
  { value: "medium", label: "中", description: "速度与思考深度平衡" },
  { value: "high", label: "高", description: "深入分析，适合复杂任务" },
  { value: "maximum", label: "最大", description: "最高思考强度，适合最复杂任务" },
] as const satisfies ReadonlyArray<{
  value: ReasoningLevel;
  label: string;
  description: string;
}>;

export function reasoningLevelIndex(value: ReasoningLevel): number {
  const index = REASONING_LEVELS.findIndex((level) => level.value === value);
  return index < 0 ? 2 : index;
}

export function reasoningLevelFromIndex(index: number): ReasoningLevel {
  const clamped = Math.max(0, Math.min(REASONING_LEVELS.length - 1, Math.round(index)));
  return REASONING_LEVELS[clamped].value;
}
