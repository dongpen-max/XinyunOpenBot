export const candidateKey = (candidate) => `${candidate.instanceId}\u0000${candidate.model}`;
function mismatch(candidate, requirements) {
    const capability = candidate.capabilities;
    if (!capability.available)
        return "当前不可用";
    if (requirements.imageInput && capability.imageInput !== true)
        return "不支持图片输入";
    if (requirements.agentTools && !capability.agentTools)
        return "不支持 Agent 工具";
    if (requirements.mcpTools && !capability.mcpTools)
        return "不支持 MCP 工具";
    if (requirements.localComputer && !capability.localComputer)
        return "不支持本地电脑操作";
    if (requirements.cloudComputer && !capability.cloudComputer)
        return "不支持云电脑操作";
    if (requirements.browser && !capability.browser)
        return "不支持浏览器操作";
    if (requirements.minimumContextTokens &&
        capability.maxContextTokens !== null &&
        capability.maxContextTokens < requirements.minimumContextTokens)
        return "上下文容量不足";
    if (candidate.health.circuitState === "open")
        return "熔断中";
    return null;
}
function healthRank(health) {
    return health.circuitState === "closed" ? 0 : health.circuitState === "half_open" ? 1 : 2;
}
function optionalNumber(a, b, direction) {
    if (a === null && b === null)
        return 0;
    if (a === null)
        return 1;
    if (b === null)
        return -1;
    return direction === "asc" ? a - b : b - a;
}
/** Hard capability filtering always happens before mode-specific ordering. */
export function routeCandidates(input) {
    if (input.mode === "manual") {
        const exact = input.candidates.find((candidate) => candidate.instanceId === input.preferred.instanceId && candidate.model === input.preferred.model);
        return { candidates: exact ? [exact] : [], excluded: [] };
    }
    const excluded = [];
    const eligible = input.candidates.filter((candidate) => {
        const reason = mismatch(candidate, input.requirements);
        if (!reason)
            return true;
        excluded.push({ instanceId: candidate.instanceId, model: candidate.model, reason });
        return false;
    });
    const preferred = (candidate) => candidate.instanceId === input.preferred.instanceId && candidate.model === input.preferred.model ? 0 : 1;
    const stable = (a, b) => a.instanceId.localeCompare(b.instanceId) || a.model.localeCompare(b.model);
    eligible.sort((a, b) => {
        const health = healthRank(a.health) - healthRank(b.health);
        if (health)
            return health;
        const failures = a.health.consecutiveFailures - b.health.consecutiveFailures;
        if (failures)
            return failures;
        const congestion = a.health.activeRequests - b.health.activeRequests;
        if (congestion)
            return congestion;
        if (input.mode === "quality") {
            const quality = optionalNumber(a.qualityScore, b.qualityScore, "desc");
            if (quality)
                return quality;
        }
        else if (input.mode === "speed" || input.mode === "balanced") {
            const latency = optionalNumber(a.health.averageLatencyMs, b.health.averageLatencyMs, "asc");
            if (latency)
                return latency;
        }
        else if (input.mode === "cost") {
            const cost = optionalNumber(a.costScore, b.costScore, "asc");
            if (cost)
                return cost;
        }
        return preferred(a) - preferred(b) || stable(a, b);
    });
    return { candidates: eligible, excluded };
}
export function detectTurnRequirements(input) {
    const imageInput = /<attached-image\b/i.test(input.text);
    return {
        ...(imageInput ? { imageInput: true } : {}),
        ...(input.agentTools ? { agentTools: true } : {}),
        ...(input.mcpTools ? { mcpTools: true } : {}),
        ...(input.computer === "cloud" ? { cloudComputer: true, browser: true } : {}),
        ...(input.computer === "local" ? { localComputer: true, browser: true } : {}),
        // In automatic routing, an unset computer preference means this is a
        // chat/tool task. Manual mode retains the legacy "auto computer" path.
        ...(!input.automatic || input.computer !== undefined ? {} : { cloudComputer: false }),
    };
}
export function nextFailoverCandidate(state, error) {
    if (state.cancelled || error.code === "cancelled")
        return { candidate: null, reason: "cancelled" };
    if (!error.recoverable)
        return { candidate: null, reason: "not_recoverable" };
    if (state.externalSideEffect || state.computerAction || state.outputProduced)
        return { candidate: null, reason: "replay_blocked" };
    if (Math.max(0, state.attempted.length - 1) >= state.maxFailovers)
        return { candidate: null, reason: "limit" };
    const used = new Set(state.attempted);
    const candidate = state.candidates.find((value) => !used.has(candidateKey(value))) ?? null;
    return candidate ? { candidate, reason: "retry" } : { candidate: null, reason: "exhausted" };
}
