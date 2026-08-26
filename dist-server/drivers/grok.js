// OpenAI-compatible chat-completions driver (kept under the historical
// `grok` kind). Besides xAI it powers relay instances serving GPT, Claude,
// Qwen, DeepSeek and other models behind the same wire protocol. Tool use is
// provider-neutral: this driver translates OpenAI function calls to the same
// MCP computer integration the CLI drivers mount directly.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeModelCatalog, newEventId, newId } from "../contracts.js";
import { connectMcpStdioMany } from "../tools/mcp-stdio.js";
import { mcpStdioConfigs } from "../mcp.js";
import { runOpenAICompatibleToolLoop, } from "../tools/openai-compatible.js";
import { appendNative } from "./native.js";
const DRIVER_KIND = "grok";
const DEFAULT_URL = "https://api.x.ai/v1";
const MODELS = {
    default: "grok-4.5",
    options: [
        { id: "grok-4.5", label: "Grok 4.5" },
        { id: "grok-4", label: "Grok 4" },
        { id: "grok-4-fast", label: "Grok 4 Fast" },
        { id: "grok-3-mini", label: "Grok 3 Mini" },
    ],
};
function decodeConfig(raw) {
    const o = (raw ?? {});
    const computerTools = o.computerTools !== false;
    return {
        url: (typeof o.url === "string" ? o.url : DEFAULT_URL).replace(/\/+$/, ""),
        apiKeyEnv: typeof o.apiKeyEnv === "string" ? o.apiKeyEnv : "XAI_API_KEY",
        models: decodeModelCatalog(o.models, MODELS),
        computerTools,
        agentTools: typeof o.agentTools === "boolean" ? o.agentTools : computerTools,
        reasoningEffort: o.reasoningEffort !== false,
    };
}
// Proxy entry files live as .ts in dev and .js in the packaged server.
const proxyPath = (basename) => {
    const ts = join(dirname(fileURLToPath(import.meta.url)), "..", `${basename}.ts`);
    return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
};
const COMPUTER_PROXY_PATH = proxyPath("computer-proxy");
const NODE_ENV_FLAG = { ELECTRON_RUN_AS_NODE: "1" };
export function computerMcpConfig(turn) {
    if (turn.integrations?.computer) {
        return {
            command: process.execPath,
            args: [COMPUTER_PROXY_PATH],
            env: {
                ...NODE_ENV_FLAG,
                OGB_BOX_ID: turn.integrations.computer.boxId,
                OGB_BOX_TOKEN: turn.integrations.computer.token,
                ...(turn.integrations.computer.control
                    ? {
                        OMB_CONTROL_URL: turn.integrations.computer.control.url,
                        OMB_CONTROL_TOKEN: turn.integrations.computer.control.token,
                    }
                    : {}),
                // Some OpenAI-compatible Claude gateways time out on full desktop
                // frames. 512px preserves usable coordinates while keeping vision
                // payloads inside their practical limit. CLI drivers keep 1280px.
                OGB_SHOT_WIDTH: "512",
            },
        };
    }
    if (turn.integrations?.localComputer)
        return turn.integrations.localComputer;
    return null;
}
export function agentsMcpConfig(turn) {
    return turn.integrations?.agents ?? null;
}
function nativeRequest(body) {
    const messages = Array.isArray(body.messages)
        ? body.messages.map((message) => ({
            ...message,
            content: Array.isArray(message?.content)
                ? message.content.map((part) => part?.type === "image_url" && typeof part.image_url?.url === "string"
                    ? {
                        ...part,
                        image_url: {
                            ...part.image_url,
                            url: `[base64 image omitted: ${part.image_url.url.length} chars]`,
                        },
                    }
                    : part)
                : message?.content,
        }))
        : body.messages;
    return { ...body, messages };
}
export const GrokDriver = {
    driverKind: DRIVER_KIND,
    // "(API)" distinguishes this key-billed driver from grokAgent, the CLI one
    metadata: { displayName: "Grok (API)", supportsMultipleInstances: true },
    models: MODELS,
    decodeConfig,
    defaultConfig: () => decodeConfig({}),
    async create(input) {
        const { instanceId, config } = input;
        const apiKey = input.environment[config.apiKeyEnv] ?? process.env[config.apiKeyEnv] ?? "";
        const providerLabel = input.displayName ?? "OpenAI-compatible API";
        const supportsReasoningEffort = config.reasoningEffort !== false;
        // An explicit per-instance relay URL must win over a global XAI_BASE_URL.
        // The environment remains the fallback for the default xAI configuration.
        const environmentBaseUrl = input.environment["XAI_BASE_URL"] ?? process.env["XAI_BASE_URL"];
        const baseUrl = config.url !== DEFAULT_URL ? config.url : environmentBaseUrl ?? config.url;
        const models = config.models;
        const listeners = new Set();
        const active = new Map();
        const emit = (event) => {
            for (const l of [...listeners])
                l(event);
        };
        const base = (threadId, turnId) => ({
            eventId: newEventId(),
            provider: DRIVER_KIND,
            threadId,
            turnId,
            createdAt: new Date().toISOString(),
        });
        const complete = async (messages, model, opts) => {
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
                body: JSON.stringify({ model, messages, stream: opts.stream }),
                signal: opts.signal ?? AbortSignal.timeout(120_000),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`${providerLabel} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
            }
            if (!opts.stream) {
                const json = await res.json();
                return {
                    text: json.choices?.[0]?.message?.content ?? "",
                    usage: json.usage
                        ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
                        : null,
                };
            }
            let text = "";
            let usage = null;
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buf += decoder.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf("\n")) !== -1) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line.startsWith("data:"))
                        continue;
                    const data = line.slice(5).trim();
                    if (data === "[DONE]")
                        continue;
                    let chunk;
                    try {
                        chunk = JSON.parse(data);
                    }
                    catch {
                        continue;
                    }
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        text += delta;
                        opts.onDelta?.(delta);
                    }
                    if (chunk.usage) {
                        usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
                    }
                }
            }
            return { text, usage };
        };
        const sendTurn = async (turn) => {
            const { threadId } = turn;
            if (!apiKey)
                throw new Error(`未配置 ${providerLabel} API Key（${config.apiKeyEnv}）`);
            if (active.has(threadId))
                throw new Error("a turn is already running on this thread");
            const turnId = newId();
            const abort = new AbortController();
            const asks = new Map();
            active.set(threadId, { abort, turnId, asks });
            const messages = [
                ...(turn.system ? [{ role: "system", content: turn.system }] : []),
                ...(turn.transcript ?? []).map((m) => ({
                    role: m.role === "assistant" ? "assistant" : "user",
                    content: m.text,
                })),
                { role: "user", content: turn.text },
            ];
            emit({ ...base(threadId, turnId), type: "turn.started" });
            emit({ ...base(threadId, turnId), type: "session.started", sessionId: null, model: turn.model ?? models.default });
            (async () => {
                let toolProvider = null;
                try {
                    const mcps = [
                        ...(config.computerTools ? [computerMcpConfig(turn)] : []),
                        ...(config.agentTools ? [agentsMcpConfig(turn)] : []),
                        ...mcpStdioConfigs(turn.integrations?.mcp),
                    ].filter((mcp) => mcp !== null);
                    toolProvider = await connectMcpStdioMany(mcps, abort.signal);
                    const policies = new Map();
                    for (const integration of turn.integrations?.mcp ?? []) {
                        for (const [tool, policy] of Object.entries(integration.toolPolicies ?? {})) {
                            policies.set(tool, { serverId: integration.id, policy });
                        }
                    }
                    const approvedProvider = toolProvider && policies.size
                        ? {
                            listTools: () => toolProvider.listTools(),
                            callTool: async (name, args) => {
                                const policy = policies.get(name);
                                if (!policy || policy.policy === "auto")
                                    return toolProvider.callTool(name, args);
                                if (policy.policy === "deny") {
                                    return { text: `MCP tool ${name} is disabled.`, images: [], isError: true };
                                }
                                const requestId = newId();
                                const behavior = await new Promise((resolve) => {
                                    const timer = setTimeout(() => {
                                        asks.delete(requestId);
                                        resolve("deny");
                                    }, 5 * 60_000);
                                    timer.unref?.();
                                    asks.set(requestId, (answer) => {
                                        clearTimeout(timer);
                                        asks.delete(requestId);
                                        resolve(answer);
                                    });
                                    emit({
                                        ...base(threadId, turnId),
                                        type: "request.opened",
                                        requestId,
                                        requestType: "permission",
                                        tool: `mcp__${policy.serverId}__${name}`,
                                        summary: `MCP 工具 ${policy.serverId}/${name} 请求执行`,
                                    });
                                });
                                emit({
                                    ...base(threadId, turnId),
                                    type: "request.resolved",
                                    requestId,
                                    behavior,
                                    source: "user",
                                });
                                return behavior === "allow"
                                    ? toolProvider.callTool(name, args)
                                    : { text: `MCP tool ${name} was denied.`, images: [], isError: true };
                            },
                            close: () => toolProvider.close(),
                        }
                        : toolProvider;
                    const { text, usage } = await runOpenAICompatibleToolLoop({
                        model: turn.model || models.default,
                        messages,
                        reasoningEffort: supportsReasoningEffort ? turn.reasoningEffort : undefined,
                        signal: abort.signal,
                        toolProvider: approvedProvider,
                        request: async (body, signal) => {
                            const res = await fetch(`${baseUrl}/chat/completions`, {
                                method: "POST",
                                headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
                                body: JSON.stringify(body),
                                signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
                            });
                            if (!res.ok) {
                                const responseBody = await res.text().catch(() => "");
                                throw new Error(`${providerLabel} HTTP ${res.status}${responseBody ? `: ${responseBody.slice(0, 200)}` : ""}`);
                            }
                            return res;
                        },
                        onRequest: (body) => appendNative(threadId, { dir: "out", source: "openai-compatible.chat.completions", msg: nativeRequest(body) }),
                        onRound: (round) => appendNative(threadId, {
                            dir: "in",
                            source: "openai-compatible.chat.completions",
                            msg: {
                                text: round.text,
                                finishReason: round.finishReason,
                                toolCalls: round.toolCalls.map((call) => ({ id: call.id, name: call.function.name })),
                                usage: round.usage,
                            },
                        }),
                        onTextDelta: (delta) => emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta }),
                        onToolStarted: (call) => emit({
                            ...base(threadId, turnId),
                            type: "item.started",
                            itemType: "tool",
                            itemId: call.id,
                            title: call.function.name,
                        }),
                        onToolCompleted: (call, result) => emit({
                            ...base(threadId, turnId),
                            type: "item.completed",
                            itemType: "tool",
                            itemId: call.id,
                            ok: !result.isError,
                        }),
                    });
                    if (text.trim()) {
                        emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
                    }
                    if (usage) {
                        emit({ ...base(threadId, turnId), type: "thread.token-usage.updated", ...usage });
                    }
                    emit({ ...base(threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
                }
                catch (e) {
                    const aborted = abort.signal.aborted || e.name === "AbortError";
                    if (!aborted) {
                        emit({ ...base(threadId, turnId), type: "runtime.error", message: e.message });
                    }
                    emit({
                        ...base(threadId, turnId),
                        type: "turn.completed",
                        ok: false,
                        stopReason: aborted ? "interrupted" : "error",
                        cost: null,
                    });
                }
                finally {
                    for (const finish of asks.values())
                        finish("deny");
                    asks.clear();
                    active.delete(threadId);
                    await toolProvider?.close();
                }
            })();
            return { turnId };
        };
        const snapshot = async () => {
            if (!apiKey) {
                return {
                    state: "unavailable",
                    reason: `未配置 ${providerLabel} API Key（${config.apiKeyEnv}）`,
                };
            }
            return { state: "available", authenticated: true, version: null };
        };
        return {
            instanceId,
            driverKind: DRIVER_KIND,
            displayName: input.displayName,
            enabled: input.enabled,
            models,
            snapshot,
            adapter: {
                provider: DRIVER_KIND,
                capabilities: {
                    sessionModelSwitch: "in-session",
                    reasoningEffort: supportsReasoningEffort,
                    computerMcp: config.computerTools,
                    agentsMcp: config.agentTools,
                    mcpTools: true,
                    streaming: true,
                    ...(config.computerTools ? { computerMode: "mcp" } : {}),
                },
                sendTurn,
                interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
                respondToRequest: async (threadId, requestId, decision) => {
                    const pending = active.get(threadId)?.asks.get(requestId);
                    if (!pending)
                        throw new Error("no such pending request");
                    pending(decision.behavior === "allow" ? "allow" : "deny");
                },
                hasSession: (threadId) => active.has(threadId),
                stopAll: async () => {
                    for (const { abort } of active.values())
                        abort.abort();
                },
                onEvent: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            },
            generateText: async (prompt) => {
                // the instance default, not a hardcoded id — a relay need not serve grok-4.5
                const { text } = await complete([{ role: "user", content: prompt }], models.default, { stream: false });
                return text;
            },
            dispose: async () => {
                for (const { abort } of active.values())
                    abort.abort();
                listeners.clear();
            },
        };
    },
};
