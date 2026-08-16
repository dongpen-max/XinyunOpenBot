const VALUES = new Set(["low", "medium", "high"]);
export function parseReasoningEffort(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value === "string" && VALUES.has(value))
        return value;
    throw Object.assign(new Error("reasoningEffort must be low, medium, or high"), { status: 400 });
}
