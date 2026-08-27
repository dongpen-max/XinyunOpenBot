// XinyunOpen Bot server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import "./load-env.js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { approvalKey, autoDecision } from "./auto-approve.js";
import * as box from "./box.js";
import { cloudComputerLeases } from "./cloud-computer-pool.js";
import * as composio from "./composio.js";
import * as mcp from "./mcp.js";
import { appendMcpAudit, recentMcpAudit } from "./mcp-audit.js";
import { chiefOfStaffSystemPrompt } from "./chief-of-staff.js";
import { ensureDirs, instanceConfigs, loadConfig, replaceMcpServers, saveConfig, DATA_DIR, EVENTS_DIR, NATIVE_DIR, TRACES_DIR } from "./config.js";
import { resetPathCache } from "./env-path.js";
import { discoverModels, saveDiscoveredModels } from "./models-discover.js";
import { modelForReasoningLevel } from "./model-downgrade.js";
import { parseReasoningRequest, reasoningEffortForLevel } from "./reasoning.js";
import { effectiveComputerPreference, shouldUseCloudComputer } from "./turn-computer.js";
import { buildTurnContext, engineIsFresh } from "./turn-context.js";
import { SseReplayBuffer } from "./sse-replay.js";
import { ComputerControl, computerControlRefusal } from "./computer-control.js";
import { extensionForMime, IMAGE_MAX_BYTES, readAttachment, saveImage } from "./attachments.js";
import { TurnScheduler } from "./turn-scheduler.js";
import { candidateKey, detectTurnRequirements, nextFailoverCandidate, routeCandidates } from "./agent-router.js";
import { classifyProviderError, providerErrorLabel, sanitizeRuntimeEvent } from "./provider-errors.js";
import { ProviderHealthTracker } from "./provider-health.js";
import { TaskTraceStore } from "./task-trace.js";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.js";
import { EventBus } from "./harness/bus.js";
import { ProviderRegistry } from "./harness/registry.js";
import { DOMESTIC_PROVIDER_IDS } from "./domestic-models.js";
import { mentionedBots, roomResponders, Store, } from "./store.js";
import { newId } from "./contracts.js";
import { describeVoice, synthesize, transcribe } from "./voice/index.js";
import { toUtterances } from "./voice/speech-text.js";
const PORT = Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799);
const STATIC_DIR = process.env.OMB_STATIC_DIR || null;
const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
};
ensureDirs();
const cfg = loadConfig();
const providerHealth = new ProviderHealthTracker(join(DATA_DIR, "provider-health.json"));
const taskTraces = new TaskTraceStore(TRACES_DIR);
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));
const bus = new EventBus();
bus.attach(registry.instances());
// ── peer-agent comms wiring ────────────────────────────────────────────
// A shared secret guards the localhost-only /api/internal endpoints the
// agents-proxy calls; regenerated each boot (the proxy gets it via env).
const COMMS_TOKEN = randomBytes(24).toString("hex");
const computerControl = new ComputerControl((botId) => broadcastComputerControl(botId));
const botBoxIds = new Map();
// Bound message chains: depth 0 = a user-initiated turn. Peer turns may
// delegate up to three hops, while the root/visited-bot budget rejects loops
// and runaway fan-out before another provider turn is scheduled.
const MAX_COMMS_DEPTH = 3;
const MAX_HANDOFFS_PER_ROOT = 8;
const HANDOFF_DEDUPE_WINDOW_MS = 5_000;
const turnScheduler = new TurnScheduler();
const handoffs = new Map();
const recentHandoffKeys = new Map();
// proxy entry: .ts in dev (node type-strips), .js in the packaged dist-server
const agentsProxyPath = (() => {
    const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-proxy.ts");
    return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
// in the packaged app process.execPath is Electron — run the proxy as node
const AGENTS_NODE_FLAG = { ELECTRON_RUN_AS_NODE: "1" };
function agentsIntegration(botId, context) {
    return {
        command: process.execPath,
        args: [agentsProxyPath],
        env: {
            ...AGENTS_NODE_FLAG,
            OMB_HARNESS_URL: `http://127.0.0.1:${PORT}`,
            OMB_BOT_ID: botId,
            OMB_COMMS_TOKEN: COMMS_TOKEN,
            OMB_TURN_DEPTH: String(context.depth),
            OMB_ROOT_TURN_ID: context.rootTurnId,
            OMB_SOURCE_TURN_ID: context.sourceTurnId,
            OMB_HANDOFF_COUNT: String(context.handoffCount),
            OMB_VISITED_BOTS: JSON.stringify(context.visitedBots),
        },
    };
}
/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
function askBotAndWait(targetBotId, message, context) {
    const target = store.bot(targetBotId);
    if (!target)
        return Promise.resolve({ text: "(no such bot)" });
    const threadId = target.threadId;
    return new Promise((resolve) => {
        let text = "";
        let started = false;
        let targetTurnId;
        let done = false;
        const finish = (out) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            unsub();
            resolve({ text: out, targetTurnId });
        };
        const unsub = bus.subscribe((e) => {
            if (e.threadId !== threadId)
                return;
            if (e.type === "turn.started") {
                started = true;
                targetTurnId = e.turnId;
            }
            else if (e.type === "item.completed" && e.itemType === "assistant_text" && started) {
                text += (text ? "\n" : "") + e.text;
            }
            else if (e.type === "turn.completed" && started) {
                finish(text || "(the bot finished without a text reply)");
            }
        });
        const timer = setTimeout(() => finish(text || "(timed out waiting for the bot to reply)"), 4 * 60_000);
        startTurn(targetBotId, message, {
            commsDepth: context.depth + 1,
            commsContext: {
                ...context,
                depth: context.depth + 1,
                visitedBots: [...context.visitedBots, targetBotId],
            },
        }).catch((err) => finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`));
    });
}
// default selection for new bots: first available instance, claude preferred
async function defaultSelection() {
    const described = await registry.describe();
    const available = described.filter((d) => d.snapshot.state === "available");
    const pick = available.find((d) => d.driverKind === "claudeAgent") ?? available[0];
    return { instanceId: pick?.instanceId ?? "", model: pick?.models.default || "" };
}
let bootSelection = { instanceId: "", model: "" };
const store = new Store(() => bootSelection);
bootSelection = await defaultSelection();
store.seedIfEmpty();
/** Provider-native continuation tokens never cross the server boundary. */
const wireTask = ({ resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, ...task }) => task;
/** Strip both the legacy active-task cursor mirror and all per-task cursors. */
const wireBot = (bot) => {
    const { resumeCursors: _resumeCursors, tasks, ...rest } = bot;
    return {
        ...rest,
        execution: {
            status: turnScheduler.isActive(bot.id) ? "running" : turnScheduler.hasPending(bot.id) ? "queued" : "idle",
            queueDepth: turnScheduler.pending(bot.id),
        },
        ...(tasks ? { tasks: tasks.map(wireTask) } : {}),
    };
};
const wireBotWithThread = (bot) => ({
    ...wireBot(bot),
    messages: store.messagesFor(bot.threadId),
    activeLeafId: store.activeLeaf(bot.threadId),
    tasks: store.tasks(bot.id).map(wireTask),
});
const sseClients = new Set();
const sseReplay = new SseReplayBuffer();
const wantsSseKind = (client, kind) => kind !== "screen" || client.screens;
function broadcast(payload) {
    const { kind, frame } = sseReplay.append(payload);
    for (const client of [...sseClients]) {
        if (!wantsSseKind(client, kind))
            continue;
        try {
            client.res.write(frame);
        }
        catch {
            sseClients.delete(client);
        }
    }
}
function broadcastBot(bot, withThread = false) {
    if (bot)
        broadcast({ kind: "bot", bot: withThread ? wireBotWithThread(bot) : wireBot(bot) });
}
function wireRoutine(routine) {
    return routine ? { ...routine } : null;
}
function broadcastRoutine(routineId) {
    const routine = store.routine(routineId);
    if (routine)
        broadcast({ kind: "routine", routine: wireRoutine(routine) });
    else
        broadcast({ kind: "routine.deleted", routineId });
}
function finishRoutineRun(threadId, ok, error) {
    const active = routineRunsByThread.get(threadId);
    if (!active)
        return;
    routineRunsByThread.delete(threadId);
    const routine = store.routine(active.routineId);
    if (!routine)
        return;
    const now = Date.now();
    const run = routine.history.find((entry) => entry.id === active.runId);
    if (run) {
        run.status = ok ? "completed" : "failed";
        run.finishedAt = now;
        if (error)
            run.error = error.slice(0, 500);
    }
    store.patchRoutine(routine.id, {
        lastStatus: ok ? "completed" : "failed",
        lastError: error ? error.slice(0, 500) : undefined,
        runCount: routine.runCount + 1,
        nextRunAt: now + routine.intervalMinutes * 60_000,
        history: routine.history.slice(0, 20),
    });
    broadcastRoutine(routine.id);
}
function broadcastComputerControl(botId) {
    const boxId = botBoxIds.get(botId);
    const related = new Set([botId]);
    if (boxId) {
        for (const [relatedBotId, relatedBoxId] of botBoxIds) {
            if (relatedBoxId === boxId)
                related.add(relatedBotId);
        }
    }
    for (const relatedBotId of related) {
        const control = effectiveComputerControl(relatedBotId);
        broadcast({ kind: "computer-control", botId: relatedBotId, control });
    }
}
function broadcastComputerLease(boxId) {
    broadcast({ kind: "computer-lease", boxId, lease: cloudComputerLeases.status(boxId) });
}
function effectiveComputerControl(botId) {
    const own = computerControl.snapshot(botId);
    const boxId = botBoxIds.get(botId);
    if (!boxId || own.held)
        return own;
    for (const [otherBotId, otherBoxId] of botBoxIds) {
        if (otherBotId === botId || otherBoxId !== boxId)
            continue;
        const other = computerControl.snapshot(otherBotId);
        if (other.held)
            return { ...other, ownerBotId: otherBotId };
    }
    return own;
}
function releaseComputerControl(botId) {
    const snapshot = computerControl.release(botId);
    broadcastComputerControl(botId);
    return snapshot;
}
// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map(); // itemId -> messageId
const mcpAuditByItem = new Map();
const askMessageByRequest = new Map(); // requestId -> messageId
const providerRequestById = new Map();
const cloudLeaseByThread = new Map();
const cloudLeaseBoxByThread = new Map();
const pendingCloudLeaseByThread = new Map();
const routineRunsByThread = new Map();
const activeRoutedTurns = new Map();
function providerForThread(threadId, fallbackInstanceId) {
    return registry.get(activeRoutedTurns.get(threadId)?.candidate.instanceId ?? fallbackInstanceId);
}
function selectionFor(candidate) {
    return { instanceId: candidate.instanceId, model: candidate.model };
}
function attemptedSelections(plan) {
    const used = new Set(plan.attempted);
    return plan.candidates.filter((candidate) => used.has(candidateKey(candidate))).map(selectionFor);
}
function appendRoutingActivity(threadId, message) {
    const saved = store.appendMessage(threadId, message);
    broadcast({ kind: "message", threadId, message: saved });
    return saved;
}
function appendFinalRoutingFailure(active, error) {
    if (error.code === "cancelled")
        return;
    appendRoutingActivity(active.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `所有可用候选均失败：${providerErrorLabel(error.code)}`, ok: false },
        routing: {
            status: "failed",
            reason: error.code,
            attempts: attemptedSelections(active.plan),
        },
    });
}
function broadcastTrace(traceId) {
    const trace = taskTraces.get(traceId);
    if (trace)
        broadcast({ kind: "trace", trace: wireTrace(trace) });
}
const wireTrace = (trace) => {
    const { userMessageId: _userMessageId, rootTurnId: _rootTurnId, ...safe } = trace;
    return safe;
};
function retryRoutedTurn(active, error) {
    if (active.plan.mode === "manual")
        return false;
    const next = nextFailoverCandidate({
        candidates: active.plan.candidates,
        attempted: active.plan.attempted,
        maxFailovers: active.plan.maxFailovers,
        cancelled: active.cancelled,
        externalSideEffect: active.externalSideEffect,
        computerAction: active.computerAction,
        outputProduced: active.outputProduced,
    }, error);
    if (!next.candidate)
        return false;
    const from = selectionFor(active.candidate);
    const to = selectionFor(next.candidate);
    taskTraces.failover(active.traceId, from, to, error.code);
    broadcastTrace(active.traceId);
    appendRoutingActivity(active.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `${active.candidate.modelLabel} ${providerErrorLabel(error.code)}，已切换到 ${next.candidate.modelLabel}`, ok: true },
        routing: { status: "failover", from, to, reason: error.code },
    });
    store.patchBot(active.botId, { lastFailover: { at: Date.now(), from, to, reason: error.code } });
    broadcastBot(store.bot(active.botId));
    activeRoutedTurns.delete(active.threadId);
    releaseCloudLease(active.threadId);
    void runTurnNow(active.botId, active.text, { ...active.options, routingPlan: active.plan }).catch((failure) => {
        appendRoutingActivity(active.threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: `自动切换失败：${providerErrorLabel(classifyProviderError(failure).code)}`, ok: false },
            routing: { status: "failed", reason: classifyProviderError(failure).code, attempts: attemptedSelections(active.plan) },
        });
        finishScheduledTurn(active.botId);
    });
    return true;
}
function releaseCloudLease(threadId) {
    cloudLeaseByThread.get(threadId)?.();
    cloudLeaseByThread.delete(threadId);
    const boxId = cloudLeaseBoxByThread.get(threadId);
    cloudLeaseBoxByThread.delete(threadId);
    if (boxId)
        broadcastComputerLease(boxId);
}
// Providers may publish running totals more than once during a turn. Keep
// only the latest snapshot and fold it once when the turn settles.
const turnUsage = new Map();
const groupTurnContexts = new Map();
const cancelledGroupTurns = new Set();
const groupBusyBots = new Map();
// Legacy single-speaker map is retained for chained turns created before the
// context is installed.
const groupSpeakers = new Map();
function markGroupBusy(group, botId) {
    const active = groupBusyBots.get(group.id) ?? new Set();
    active.add(botId);
    groupBusyBots.set(group.id, active);
    store.patchGroup(group.id, { busyBotId: [...active][0] ?? null });
    broadcastGroup(group.id);
}
function markGroupIdle(group, botId) {
    const active = groupBusyBots.get(group.id);
    active?.delete(botId);
    if (active?.size)
        store.patchGroup(group.id, { busyBotId: [...active][0] ?? null });
    else {
        groupBusyBots.delete(group.id);
        store.patchGroup(group.id, { busyBotId: null });
    }
    broadcastGroup(group.id);
}
bus.subscribe((event) => {
    // Renderer diagnostics never receive provider-native payloads, headers or
    // raw error text. The folded chat activity below is the public projection.
    broadcast({ kind: "runtime", event: sanitizeRuntimeEvent(event) });
    const routed = activeRoutedTurns.get(event.threadId);
    const routedEvent = routed && (!event.providerInstanceId || event.providerInstanceId === routed.candidate.instanceId)
        ? routed
        : undefined;
    if (routedEvent) {
        if (taskTraces.runtime(routedEvent.traceId, event))
            broadcastTrace(routedEvent.traceId);
    }
    if (routedEvent && event.type === "item.started" && event.itemType === "tool")
        routedEvent.externalSideEffect = true;
    if (routedEvent && event.type === "item.completed" && event.itemType === "assistant_text" && event.text.trim()) {
        routedEvent.outputProduced = true;
    }
    const context = groupTurnContexts.get(event.threadId);
    const logicalThreadId = context?.groupThreadId ?? event.threadId;
    const bot = context ? store.bot(context.botId) : store.botByThread(event.threadId);
    const group = context ? store.groupByThread(logicalThreadId) : bot ? undefined : store.groupByThread(event.threadId);
    if (!bot && !group)
        return;
    const speaker = context?.speaker ?? (group ? groupSpeakers.get(event.threadId) : undefined);
    const pushMessage = (m) => {
        const message = store.appendMessage(logicalThreadId, group && m.role === "bot" ? { ...m, from: speaker } : m);
        broadcast({ kind: "message", threadId: logicalThreadId, message });
        return message;
    };
    switch (event.type) {
        case "session.started":
            if (bot && !context && event.sessionId && event.providerInstanceId) {
                store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId, event.threadId);
            }
            break;
        case "item.completed":
            if (event.itemType === "assistant_text") {
                pushMessage({ role: "bot", kind: "text", text: event.text });
            }
            else if (event.itemType === "tool" && event.itemId) {
                const auditKey = `${event.threadId}:${event.turnId ?? ""}:${event.itemId}`;
                const audit = mcpAuditByItem.get(auditKey);
                if (audit) {
                    const completedAt = event.createdAt;
                    const started = Date.parse(audit.startedAt);
                    const completed = Date.parse(completedAt);
                    appendMcpAudit({
                        ...audit,
                        completedAt,
                        durationMs: Number.isFinite(started) && Number.isFinite(completed) ? completed - started : 0,
                        ok: event.ok,
                    });
                    mcpAuditByItem.delete(auditKey);
                }
                const messageId = toolMessageByItem.get(event.itemId);
                let toolName = "tool";
                if (messageId) {
                    toolName = store.messagesFor(logicalThreadId).find((m) => m.id === messageId)?.tool?.name ?? "tool";
                    const patched = store.patchMessage(logicalThreadId, messageId, {
                        tool: { name: toolName, ok: event.ok },
                    });
                    if (patched)
                        broadcast({ kind: "message.patch", threadId: logicalThreadId, message: patched });
                    toolMessageByItem.delete(event.itemId);
                }
                // the bot just acted ON ITS SCREEN — refresh the preview now. Only
                // computer tools can change the screen, and each capture competes
                // with the agent for the box's command endpoint, so a bot grinding
                // through file edits must not trigger one per tool.
                if (bot && /computer|screenshot|click|type_text|press_key|scroll|open_url/i.test(toolName)) {
                    pokeScreenPoller(bot.id);
                }
            }
            break;
        case "item.started":
            if (event.itemType === "tool") {
                const managed = mcp.resolveManagedMcpTool(cfg, event.title);
                if (managed && event.itemId) {
                    mcpAuditByItem.set(`${event.threadId}:${event.turnId ?? ""}:${event.itemId}`, {
                        botId: bot?.id ?? speaker?.botId ?? null,
                        threadId: event.threadId,
                        serverId: managed.serverId,
                        tool: managed.tool,
                        startedAt: event.createdAt,
                    });
                }
                // ask_bot's raw tool chip is redundant — the internal endpoint
                // appends a richer "Messaged @X" chip linking to the channel
                if (event.title?.endsWith("__ask_bot"))
                    break;
                const message = pushMessage({ role: "bot", kind: "activity", tool: { name: event.title ?? "tool" } });
                if (event.itemId)
                    toolMessageByItem.set(event.itemId, message.id);
            }
            break;
        case "request.opened": {
            const permission = event.requestType === "permission";
            if (event.requestId && event.providerInstanceId) {
                providerRequestById.set(event.requestId, {
                    providerThreadId: event.threadId,
                    logicalThreadId,
                    instanceId: event.providerInstanceId,
                });
            }
            // Auto mode / always-allow: answer routine tool permissions for the
            // bot so it keeps working. A QUESTION always reaches the human — the
            // whole point of asking is that a person decides — and anything that
            // looks destructive stops even in auto mode.
            const asker = bot ?? (speaker ? store.bot(speaker.botId) : undefined);
            const forceAsk = permission && mcp.managedMcpToolPolicy(cfg, event.tool) === "ask";
            const settled = permission && !forceAsk && asker && event.requestId
                ? autoDecision(asker, event.tool, event.summary)
                : null;
            if (settled && asker && event.requestId) {
                const instance = registry.get(event.providerInstanceId ?? asker.modelSelection.instanceId);
                const requestId = event.requestId;
                const { tool, summary } = event;
                // The chip is written only AFTER the provider takes the answer.
                // Claiming approval first and correcting later means a moment
                // where the transcript says "approved" over a request nothing
                // answered — and if the provider is gone entirely, forever.
                void (async () => {
                    try {
                        if (!instance)
                            throw new Error("provider unavailable");
                        await instance.adapter.respondToRequest(event.threadId, requestId, { behavior: "allow" });
                        pushMessage({
                            role: "bot",
                            kind: "activity",
                            tool: { name: `${settled}: ${summary.slice(0, 120)}`, ok: true },
                        });
                    }
                    catch {
                        // couldn't answer it for them — hand it back to the human
                        // rather than leaving the bot waiting on nobody
                        const card = pushMessage({
                            role: "bot",
                            kind: "options",
                            card: {
                                title: "Approval needed",
                                subtitle: summary,
                                options: ["Allow", "Deny"],
                                requestId,
                                tool,
                                allowKey: approvalKey(tool, summary),
                                held: "Auto mode couldn't answer this one.",
                            },
                        });
                        askMessageByRequest.set(requestId, card.id);
                    }
                })();
                break;
            }
            const message = pushMessage({
                role: "bot",
                kind: "options",
                card: {
                    title: permission ? "Approval needed" : "Your bot has a question",
                    subtitle: event.summary,
                    options: event.choices?.length ? event.choices : permission ? ["Allow", "Deny"] : [],
                    requestId: event.requestId,
                    tool: permission ? event.tool : undefined,
                    // the exact grant "always allow" would remember, decided here so
                    // client and server can never derive it differently
                    allowKey: permission ? approvalKey(event.tool, event.summary) : undefined,
                    // in auto mode a card can only mean the guard stopped it — say so
                    held: permission && asker?.autoApprove ? "This looked destructive, so auto mode stopped to ask." : undefined,
                },
            });
            if (event.requestId)
                askMessageByRequest.set(event.requestId, message.id);
            break;
        }
        case "request.resolved": {
            const messageId = event.requestId ? askMessageByRequest.get(event.requestId) : null;
            if (messageId) {
                const existing = store.messagesFor(logicalThreadId).find((m) => m.id === messageId);
                if (existing?.card && !existing.card.answered) {
                    const patched = store.patchMessage(logicalThreadId, messageId, {
                        card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
                    });
                    if (patched)
                        broadcast({ kind: "message.patch", threadId: logicalThreadId, message: patched });
                }
                if (event.requestId)
                    askMessageByRequest.delete(event.requestId);
                if (event.requestId)
                    providerRequestById.delete(event.requestId);
            }
            break;
        }
        case "runtime.error":
            if (routedEvent)
                routedEvent.lastError = classifyProviderError(event.message);
            // Group attempts own their retry decision and publish only the final
            // safe failure (or a switch activity), avoiding one scary error chip
            // for an attempt that immediately recovered on another candidate.
            else if (!context)
                pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${providerErrorLabel(classifyProviderError(event.message).code)}`, ok: false } });
            break;
        case "thread.token-usage.updated":
            turnUsage.set(event.threadId, { input: event.input, output: event.output });
            break;
        case "turn.completed": {
            for (const [requestId, request] of providerRequestById) {
                if (request.providerThreadId === event.threadId)
                    providerRequestById.delete(requestId);
            }
            let safeRoutingError;
            if (routedEvent) {
                if (event.ok) {
                    providerHealth.recordSuccess(routedEvent.attempt);
                    taskTraces.finish(routedEvent.traceId, "completed");
                    broadcastTrace(routedEvent.traceId);
                }
                else {
                    const classified = routedEvent.cancelled
                        ? classifyProviderError("cancelled by user")
                        : routedEvent.lastError ?? classifyProviderError(event.stopReason ?? "provider turn failed");
                    safeRoutingError = providerErrorLabel(classified.code);
                    if (classified.code === "cancelled")
                        providerHealth.recordCancelled(routedEvent.attempt);
                    else
                        providerHealth.recordFailure(routedEvent.attempt, classified);
                    if (retryRoutedTurn(routedEvent, classified))
                        return;
                    appendFinalRoutingFailure(routedEvent, classified);
                    taskTraces.finish(routedEvent.traceId, classified.code === "cancelled" ? "cancelled" : "failed", classified.code);
                    broadcastTrace(routedEvent.traceId);
                }
                activeRoutedTurns.delete(event.threadId);
            }
            finishRoutineRun(event.threadId, event.ok, event.ok ? undefined : safeRoutingError ?? "机器人运行失败");
            const usage = turnUsage.get(event.threadId);
            turnUsage.delete(event.threadId);
            // Group turns share a room thread, so only 1:1 task turns currently
            // have an unambiguous task tally.
            if (bot && !context && usage)
                store.addTaskUsage(bot.id, event.threadId, usage);
            const auditPrefix = `${event.threadId}:${event.turnId ?? ""}:`;
            for (const [key, audit] of mcpAuditByItem) {
                if (!key.startsWith(auditPrefix))
                    continue;
                const completedAt = event.createdAt;
                const started = Date.parse(audit.startedAt);
                const completed = Date.parse(completedAt);
                appendMcpAudit({
                    ...audit,
                    completedAt,
                    durationMs: Number.isFinite(started) && Number.isFinite(completed) ? completed - started : 0,
                    ok: false,
                });
                mcpAuditByItem.delete(key);
            }
            // A deleted bot no longer resolves through store.bot(), so its
            // terminal event must still release the physical Box lease.
            if (!bot)
                releaseCloudLease(event.threadId);
            if (bot && !context) {
                store.patchBot(bot.id, { unread: true });
                broadcastBot(store.bot(bot.id));
                if (screenPollers.has(bot.id)) {
                    // the last live frame becomes a settled inline screen message —
                    // the screenshot-in-chat moment. One fresh capture first, so the
                    // frame shows the turn's END state (the final tool's poke may
                    // still be in flight).
                    void finalScreenFrame(bot.id).then((frame) => {
                        // the bot may have been deleted while the capture ran
                        if (frame && store.bot(bot.id)) {
                            pushMessage({ role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
                        }
                    }).finally(() => {
                        releaseCloudLease(event.threadId);
                    });
                }
                else {
                    releaseCloudLease(event.threadId);
                }
                finishScheduledTurn(bot.id);
            }
            // group busy/unread settle in the group turn engine, which knows
            // whether more member turns are queued behind this one
            break;
        }
    }
});
const screenPollers = new Map();
/** The preview shares the box's single command endpoint with the agent's
 * own actions, so every frame we take is latency stolen from the work the
 * user is waiting on. Hence: a slow interval, a floor between captures,
 * and never two in flight. */
const SCREEN_POLL_MS = 6000;
const SCREEN_MIN_GAP_MS = 3000;
function startScreenPoller(botId, boxId) {
    if (screenPollers.has(botId) || !box.boxConfigured(cfg))
        return;
    // One capture at a time, shared by the interval, the pokes, and the
    // turn-end grab: awaiting the in-flight promise (rather than dropping the
    // call) is what lets the final frame be the settled one. The min-gap keeps
    // a tool-heavy turn from spending the box's single command endpoint on
    // previews the user isn't waiting for.
    let current = null;
    let lastAt = 0;
    const entry = {
        timer: null,
        capture: () => {
            if (!current && Date.now() - lastAt < SCREEN_MIN_GAP_MS)
                return Promise.resolve();
            current ??= (async () => {
                try {
                    // boxId is resolved once per turn — re-resolving per frame cost a
                    // full LIST of the account's boxes
                    const { png, format } = await box.screenshotBox(cfg, botId, boxId);
                    const frame = { png, mime: format === "jpeg" ? "image/jpeg" : "image/png" };
                    entry.last = frame;
                    broadcast({ kind: "screen", botId, ...frame });
                }
                catch {
                    /* box asleep or mid-command — try again next tick */
                }
                finally {
                    lastAt = Date.now();
                    current = null;
                }
            })();
            return current;
        },
        last: null,
    };
    entry.timer = setInterval(() => void entry.capture(), SCREEN_POLL_MS);
    screenPollers.set(botId, entry);
}
/** Event-driven refresh: capture NOW (the bot just acted on its screen)
 * instead of waiting for the next interval tick. Rate-limited inside
 * capture() — a tool-heavy turn used to fire one full REST chain per
 * completed tool, competing with the agent for the same endpoint. */
function pokeScreenPoller(botId) {
    void screenPollers.get(botId)?.capture();
}
function stopScreenPoller(botId) {
    const entry = screenPollers.get(botId);
    if (!entry)
        return;
    if (entry.timer)
        clearInterval(entry.timer);
    screenPollers.delete(botId);
}
/** Turn end: stop polling, then take ONE last fresh frame (awaiting any
 * in-flight poke first) so the settled screenshot shows the screen's actual
 * end state, not the previous action's. */
async function finalScreenFrame(botId) {
    const entry = screenPollers.get(botId);
    if (!entry)
        return null;
    if (entry.timer)
        clearInterval(entry.timer);
    screenPollers.delete(botId);
    await entry.capture();
    return entry.last;
}
// Where Electron's app.getPath("userData") lands, per platform — the
// hardcoded macOS path found nothing anywhere else, and threw the
// non-ENOENT errors into the same silent catch.
// `||`, not `??`: a set-but-empty APPDATA/XDG_CONFIG_HOME would otherwise
// join into a RELATIVE path resolved against the server's cwd — the same
// silent ENOENT this function exists to stop. Electron ignores empty values
// the same way.
function userDataRoot() {
    if (process.platform === "win32")
        return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    if (process.platform === "darwin")
        return join(homedir(), "Library", "Application Support");
    return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}
// Local computer-use contract written by Electron main on startup
// (Electron's userData dir: ~/Library/Application Support on macOS,
// %APPDATA% on Windows — <dir>/cua-connection.json). Read fresh each turn —
// Electron may restart or permissions may change.
function readCuaConnection() {
    // Windows packages the Cua SDK as a native Node module rather than a
    // `cua-driver` executable. Run our tiny stdio MCP bridge with Electron's
    // Node so it uses the exact same architecture and DLL search path as the
    // desktop app. This must be returned before the legacy descriptor: old
    // installs can leave an unavailable macOS-style descriptor behind.
    if (process.platform === "win32") {
        const proxy = join(dirname(fileURLToPath(import.meta.url)), "local-computer-proxy.ts");
        const compiled = proxy.replace(/\.ts$/, ".js");
        const packaged = !existsSync(proxy);
        return {
            command: process.execPath,
            args: [existsSync(proxy) ? "--experimental-strip-types" : "", existsSync(proxy) ? proxy : compiled].filter(Boolean),
            env: {
                ELECTRON_RUN_AS_NODE: "1",
                ...(packaged
                    ? { OMB_CUA_SDK_ROOT: join(dirname(fileURLToPath(import.meta.url)), "cua-sdk") }
                    : {}),
            },
        };
    }
    // new name first; pre-rename desktop builds used the old directory
    for (const dir of ["XinyunOpen Bot", "openmausbot", "OpenGrokBot", "opengrokbot"]) {
        try {
            const p = join(userDataRoot(), dir, "cua-connection.json");
            const conn = JSON.parse(readFileSync(p, "utf8"));
            if (!conn || conn.mode === "unavailable" || !conn.mcpCommand)
                continue;
            return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: conn.mcpEnv ?? {} };
        }
        catch {
            /* try the next location */
        }
    }
    return null;
}
// ── turn dispatch (upstream ProviderCommandReactor, miniature) ──────────
function parseReplyReference(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const input = value;
    const messageId = typeof input.messageId === "string" ? input.messageId.trim().slice(0, 120) : "";
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
    const role = input.role === "bot" || input.role === "user" ? input.role : null;
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? input.at : 0;
    if (!messageId || !text || !role || !at)
        return undefined;
    const author = typeof input.author === "string" ? input.author.trim().slice(0, 120) : undefined;
    return { messageId, role, text, at, ...(author ? { author } : {}) };
}
function replyReferenceForThread(threadId, value) {
    const requested = parseReplyReference(value);
    if (!requested)
        return undefined;
    const source = store.messagesFor(threadId).find((message) => message.id === requested.messageId && message.kind === "text" && message.text);
    if (!source)
        return undefined;
    return {
        messageId: source.id,
        role: source.role,
        text: source.text.slice(0, 4000),
        at: source.at,
        ...(source.from?.name ? { author: source.from.name } : source.role === "user" ? { author: "你" } : {}),
    };
}
async function createRoutingPlan(bot, text) {
    const mode = bot.routingMode ?? "manual";
    // Compatibility path: a manual turn resolves only the selected instance
    // and never probes or waits on unrelated providers. This preserves the
    // pre-router dispatch behavior, including hand-written model ids.
    if (mode === "manual") {
        const live = registry.get(bot.modelSelection.instanceId);
        if (!live)
            throw Object.assign(new Error("没有可用的 Agent/模型候选"), { status: 409 });
        const adapter = live.adapter.capabilities;
        const candidate = {
            instanceId: live.instanceId,
            driverKind: live.driverKind,
            displayName: live.displayName ?? live.driverKind,
            model: bot.modelSelection.model,
            modelLabel: live.models.options.find((model) => model.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model,
            capabilities: {
                textChat: true,
                reasoningLevels: adapter.reasoningEffort ? ["low", "medium", "high"] : [],
                coding: adapter.coding ?? null,
                agentTools: adapter.agentsMcp === true,
                mcpTools: adapter.mcpTools === true,
                imageInput: adapter.imageInput ?? null,
                imageGeneration: adapter.imageGeneration ?? null,
                localComputer: adapter.computerMode === "mcp",
                cloudComputer: adapter.computerMode !== undefined,
                browser: adapter.browser ?? adapter.computerMode !== undefined,
                maxContextTokens: adapter.maxContextTokens ?? null,
                sessionResume: adapter.sessionResume === true,
                streaming: adapter.streaming ?? null,
                available: true,
            },
            health: providerHealth.snapshot(live.instanceId, bot.modelSelection.model),
            qualityScore: null,
            costScore: null,
        };
        return { mode, candidates: [candidate], attempted: [], maxFailovers: 0 };
    }
    const described = await registry.describe(providerHealth);
    const candidates = [];
    for (const entry of described) {
        const instanceCapabilities = entry.capabilities;
        for (const model of entry.models.options) {
            candidates.push({
                instanceId: entry.instanceId,
                driverKind: entry.driverKind,
                displayName: entry.displayName,
                model: model.id,
                modelLabel: model.label,
                capabilities: (model.capabilities ?? instanceCapabilities),
                health: model.health ?? providerHealth.snapshot(entry.instanceId, model.id),
                qualityScore: typeof model.qualityScore === "number" ? model.qualityScore : null,
                costScore: typeof model.costScore === "number" ? model.costScore : null,
            });
        }
    }
    const requirements = detectTurnRequirements({
        text,
        computer: bot.computer,
        automatic: true,
        agentTools: Boolean(bot.chiefOfStaff || mentionedBots(text, store.bots.filter((candidate) => candidate.id !== bot.id)).length),
        mcpTools: mcp.activeMcpIntegrations(cfg, bot.id).length > 0,
    });
    const decision = routeCandidates({ mode, preferred: bot.modelSelection, requirements, candidates });
    if (!decision.candidates.length) {
        const reasons = [...new Set(decision.excluded.map((entry) => entry.reason))].slice(0, 3).join("、");
        throw Object.assign(new Error(reasons ? `所有可用候选均不满足任务能力：${reasons}` : "没有可用的 Agent/模型候选"), { status: 409 });
    }
    return {
        mode,
        candidates: decision.candidates,
        attempted: [],
        maxFailovers: Math.min(4, Math.max(0, bot.maxFailovers ?? 2)),
    };
}
async function runTurnNow(botId, text, opts = {}) {
    const bot = store.bot(botId);
    if (!bot)
        throw Object.assign(new Error("no such bot"), { status: 404 });
    const threadId = bot.threadId;
    const task = store.taskByThread(bot.id, threadId);
    if (!task)
        throw Object.assign(new Error("no such task"), { status: 404 });
    const commsDepth = opts.commsDepth ?? 0;
    const commsContext = {
        rootTurnId: opts.commsContext?.rootTurnId ?? newId(),
        sourceTurnId: newId(),
        depth: commsDepth,
        handoffCount: opts.commsContext?.handoffCount ?? 0,
        visitedBots: [...new Set([...(opts.commsContext?.visitedBots ?? []), botId])],
    };
    const traceId = opts.traceId ?? taskTraces.create({ threadId, botId, userMessageId: opts.userMessage?.id }).id;
    opts = { ...opts, traceId };
    taskTraces.start(traceId, commsContext.rootTurnId);
    broadcastTrace(traceId);
    // a task takes its name from the first thing you asked it to do
    if (text.trim())
        store.titleTaskFromFirstMessage(bot.id, text);
    const plan = opts.routingPlan ?? await createRoutingPlan(bot, text);
    if (!opts.routingPlan && plan.mode !== "manual") {
        appendRoutingActivity(threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: "正在选择合适的 Agent", ok: true },
            routing: { status: "selecting" },
        });
    }
    const candidate = plan.candidates.find((value) => !plan.attempted.includes(candidateKey(value)));
    if (!candidate)
        throw Object.assign(new Error("所有候选均已尝试"), { status: 409 });
    const instance = registry.get(candidate.instanceId);
    if (!instance) {
        throw Object.assign(new Error(`provider instance "${candidate.instanceId}" is unavailable — pick another model in settings`), { status: 409 });
    }
    const instanceId = instance.instanceId;
    const reasoningEffort = reasoningEffortForLevel(opts.reasoningLevel);
    const turnModel = modelForReasoningLevel(instance.models, candidate.model, opts.reasoningLevel);
    // an edit hands us its already-branched user message; a plain send appends
    let userMessage = opts.userMessage;
    if (!userMessage) {
        userMessage = store.appendMessage(threadId, { role: "user", kind: "text", text });
        broadcast({ kind: "message", threadId, message: userMessage });
    }
    // transcript for API-backed drivers: settled text turns on the ACTIVE
    // branch only — abandoned forks never reach the model
    const transcript = store
        .activePath(threadId)
        .filter((m) => m.kind === "text" && m.text && m.id !== userMessage.id)
        .slice(-40)
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    // After a rewind (edit / branch switch) the provider's native session
    // still contains the abandoned branch: start a fresh session instead of
    // resuming, and for cursor-resuming drivers replay the surviving path
    // inline (transcript-replay drivers get it via transcript). The flag is
    // cleared only once the turn is actually dispatched — clearing it here
    // would cost the next attempt its history if this dispatch fails.
    const rewound = Boolean(bot.rewound);
    const fresh = !rewound &&
        engineIsFresh({
            instanceId,
            lastInstanceId: task.lastInstanceId,
            resumeCursors: task.resumeCursors,
            transcript,
        });
    const promptText = userMessage.replyTo
        ? `[用户正在回复${userMessage.replyTo.author ? ` ${userMessage.replyTo.author}` : ""}的消息：\"${userMessage.replyTo.text.slice(0, 1200)}\"]\n\n${text}`
        : text;
    const { turnText, resume } = buildTurnContext({
        text: promptText,
        transcript,
        rewound,
        fresh,
        replaysNatively: instance.driverKind === "grok",
    });
    const persona = [
        `You are ${bot.name}, a personal bot in XinyunOpen Bot.`,
        bot.title && `Role: ${bot.title}.`,
        bot.description && `About: ${bot.description}`,
    ]
        .filter(Boolean)
        .join(" ");
    // busy flips immediately so the composer locks; the dispatch itself runs
    // in the background — box provisioning can take ~90s and must never
    // hang the HTTP request
    store.patchBot(bot.id, { busy: true, unread: false });
    broadcastBot(store.bot(bot.id));
    void (async () => {
        let activeAttempt = null;
        try {
            const integrations = {};
            if (cfg.composio?.key)
                integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
            const managedMcp = mcp.activeMcpIntegrations(cfg, bot.id);
            if (managedMcp.length)
                integrations.mcp = managedMcp;
            const wants = effectiveComputerPreference(bot.computer, plan.mode);
            // Capability, not provider name, decides whether this exact engine can
            // work through a cloud computer. `native` runs the whole turn on Box;
            // `mcp` mounts the provider-neutral computer proxy.
            const computerMode = instance.adapter.capabilities.computerMode;
            const computerRefusal = computerControlRefusal(effectiveComputerControl(bot.id));
            if (computerMode && wants !== "off" && computerRefusal) {
                throw new Error(computerRefusal);
            }
            if (wants === "cloud" && !computerMode) {
                throw new Error("当前模型仅支持对话/本地编程，不能操作云端电脑；请切换到标有“支持云端工作”的模型");
            }
            let previewBoxId = null;
            let cloudFailure = null;
            if (shouldUseCloudComputer(wants, computerMode, commsDepth)) {
                if (!box.boxConfigured(cfg)) {
                    if (wants === "cloud")
                        throw new Error("尚未配置 Box 令牌，无法启动云端电脑");
                }
                else {
                    try {
                        broadcast({ kind: "computer", botId: bot.id, state: "checking" });
                        let b = await box.findBox(cfg, bot.id).catch(() => null);
                        if (!b) {
                            if (!box.automaticBoxCreationEnabled(cfg)) {
                                throw new Error("未找到云端电脑；本机已禁止自动创建，请在电脑面板中明确执行创建命令");
                            }
                            await box.provisionBox(cfg, bot.id, bot.name, (state) => broadcast({ kind: "computer", botId: bot.id, state }));
                            b = await box.findBox(cfg, bot.id).catch(() => null);
                        }
                        if (!b)
                            throw new Error("云端电脑创建后仍无法解析，请稍后重试");
                        if (!["idle", "ready", "running"].includes(b.state)) {
                            broadcast({ kind: "computer", botId: bot.id, state: "waking" });
                            b = (await box.readyBox(cfg, bot.id).catch(() => null)) ?? b;
                        }
                        if (!["idle", "ready", "running"].includes(b.state)) {
                            throw new Error(`云端电脑当前状态为 ${b.state ?? "unknown"}，未能进入可工作状态`);
                        }
                        previewBoxId = b.id;
                        botBoxIds.set(bot.id, b.id);
                        integrations.computer = {
                            boxId: b.id,
                            token: cfg.box.token,
                            control: {
                                botId: bot.id,
                                url: `http://127.0.0.1:${PORT}/api/internal/computer-control/${encodeURIComponent(bot.id)}`,
                                token: COMMS_TOKEN,
                            },
                        };
                    }
                    catch (error) {
                        cloudFailure = error instanceof Error ? error : new Error(String(error));
                        if (wants === "cloud")
                            throw cloudFailure;
                    }
                }
            }
            // local computer (this Mac) via the Electron-hosted cua-driver: the
            // Electron main process owns the daemon (TCC attribution) and writes
            // its spawn contract to cua-connection.json; the harness only reads it
            if (!integrations.computer && computerMode === "mcp" && wants !== "off" && wants !== "cloud") {
                const cua = readCuaConnection();
                if (cua)
                    integrations.localComputer = cua;
            }
            if (cloudFailure && !integrations.localComputer)
                throw cloudFailure;
            // peer-agent comms: give a user-initiated turn the list_bots/ask_bot
            // tools. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
            // stop, so the user's tokens can't be burned by a bot-to-bot loop.
            // Only drivers that mount the tools get the integration (and, via the
            // integrations.agents gate below, the prompt hint) — a bot on a driver
            // without it must not be told about tools it cannot call. Any bot can
            // still be the TARGET of ask_bot regardless of its driver.
            if (commsDepth < MAX_COMMS_DEPTH &&
                instance.adapter.capabilities.agentsMcp === true &&
                store.bots.filter((b) => b.id !== bot.id && !b.hidden).length > 0) {
                integrations.agents = agentsIntegration(bot.id, commsContext);
            }
            // @mentions in the user's message (the composer's tagging UI) become
            // an explicit delegation nudge — the agent still does the ask_bot call
            // itself, so the harness stays the single owner of turns/permissions
            const tagged = integrations.agents
                ? mentionedBots(text, store.bots.filter((b) => b.id !== bot.id))
                : [];
            const coordinationPrompt = bot.chiefOfStaff
                ? chiefOfStaffSystemPrompt(bot.id, store.bots, Boolean(integrations.agents))
                : integrations.agents
                    ? "你可以通过机器人协作工具与其他机器人配合：list_bots 查看可用机器人，ask_bot 向指定机器人发送任务并取得回复。"
                    : "";
            if (integrations.computer) {
                const leaseWaitStartedAt = Date.now();
                const leaseAbort = new AbortController();
                pendingCloudLeaseByThread.set(threadId, leaseAbort);
                try {
                    const release = await cloudComputerLeases.acquire(integrations.computer.boxId, () => {
                        broadcast({ kind: "computer", botId: bot.id, state: "waiting" });
                        broadcastComputerLease(integrations.computer.boxId);
                    }, leaseAbort.signal, { botId: bot.id, task: text.slice(0, 160) });
                    cloudLeaseByThread.set(threadId, release);
                    cloudLeaseBoxByThread.set(threadId, integrations.computer.boxId);
                    broadcastComputerLease(integrations.computer.boxId);
                    broadcast({ kind: "computer", botId: bot.id, state: "ready" });
                    taskTraces.computer(traceId, "获得云电脑串行使用权", Date.now() - leaseWaitStartedAt);
                    broadcastTrace(traceId);
                }
                finally {
                    pendingCloudLeaseByThread.delete(threadId);
                }
            }
            plan.attempted.push(candidateKey(candidate));
            taskTraces.attempt(traceId, { instanceId, model: turnModel });
            broadcastTrace(traceId);
            const healthAttempt = providerHealth.startAttempt(instanceId, turnModel);
            activeAttempt = {
                botId: bot.id,
                threadId,
                text,
                options: { ...opts, userMessage, routingPlan: plan },
                plan,
                candidate,
                attempt: healthAttempt,
                externalSideEffect: false,
                computerAction: Boolean(integrations.computer || integrations.localComputer),
                outputProduced: false,
                cancelled: false,
                traceId,
            };
            activeRoutedTurns.set(threadId, activeAttempt);
            await instance.adapter.sendTurn({
                threadId,
                text: turnText,
                permissionMode: bot.autoApprove ? "auto" : "ask",
                model: turnModel,
                reasoningEffort,
                // a rewound thread never resumes the abandoned branch's session
                // the active task's own session — another task's cursor would
                // resume the wrong conversation and defeat the context bubble
                resumeCursor: resume ? task.resumeCursors[instanceId] : undefined,
                transcript,
                system: persona +
                    (integrations.computer && computerMode === "mcp"
                        ? " You have your own cloud computer — use the computer tools (screenshot, click, type_text, open_url, computer_exec) whenever browsing or acting on a desktop helps. Every action tool already returns the resulting screen, so don't follow one with a screenshot call, and batch predictable sequences with computer_batch. At sign-in, CAPTCHA, protected input, or an uncertain visual choice, call computer_request_help with a short reason and wait for the user to finish before continuing."
                        : integrations.localComputer
                            ? " You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
                            : "") +
                    (integrations.computer || integrations.localComputer
                        ? " At a sign-in, password, MFA, CAPTCHA, or other protected-input step, stop and ask the user to complete it on the visible computer. Never type their password or ask them to paste a password or one-time code into chat."
                        : "") +
                    (coordinationPrompt ? ` ${coordinationPrompt}` : "") +
                    (tagged.length
                        ? ` The user tagged ${tagged
                            .map((t) => `@${t.name} (ask_bot bot_id ${t.id})`)
                            .join(" and ")} in their message — bring them in with ask_bot and fold their reply into your answer.`
                        : ""),
                integrations,
            });
            // dispatched: the rewind is spent, and the old cursors are dead
            if (rewound)
                store.patchBot(bot.id, { rewound: false, resumeCursors: {} });
            store.markTaskDispatched(bot.id, threadId, instanceId);
            if (previewBoxId)
                startScreenPoller(bot.id, previewBoxId);
        }
        catch (e) {
            releaseCloudLease(threadId);
            if (activeAttempt && activeRoutedTurns.get(threadId) === activeAttempt) {
                activeRoutedTurns.delete(threadId);
                const classified = classifyProviderError(e);
                providerHealth.recordFailure(activeAttempt.attempt, classified);
                if (retryRoutedTurn(activeAttempt, classified))
                    return;
                appendFinalRoutingFailure(activeAttempt, classified);
                taskTraces.finish(traceId, classified.code === "cancelled" ? "cancelled" : "failed", classified.code);
                broadcastTrace(traceId);
            }
            else if (!activeAttempt) {
                const classified = classifyProviderError(e);
                appendRoutingActivity(threadId, {
                    role: "bot",
                    kind: "activity",
                    tool: { name: `任务启动失败：${providerErrorLabel(classified.code)}`, ok: false },
                    routing: { status: "failed", reason: classified.code, attempts: attemptedSelections(plan) },
                });
                taskTraces.finish(traceId, classified.code === "cancelled" ? "cancelled" : "failed", classified.code);
                broadcastTrace(traceId);
            }
            else {
                return;
            }
            store.patchBot(bot.id, { busy: false });
            broadcastBot(store.bot(bot.id));
            finishScheduledTurn(bot.id);
        }
    })();
}
function finishScheduledTurn(botId) {
    if (!turnScheduler.isActive(botId))
        return;
    turnScheduler.complete(botId);
    if (turnScheduler.hasPending(botId)) {
        store.patchBot(botId, { busy: true });
        broadcastBot(store.bot(botId));
        void drainBotQueue(botId);
    }
    else {
        store.patchBot(botId, { busy: false });
        broadcastBot(store.bot(botId));
    }
}
async function drainBotQueue(botId) {
    const next = turnScheduler.begin(botId);
    if (!next)
        return;
    try {
        await runTurnNow(botId, next.value.text, next.value.options);
    }
    catch (error) {
        if (next.value.options?.traceId) {
            const code = classifyProviderError(error).code;
            taskTraces.finish(next.value.options.traceId, code === "cancelled" ? "cancelled" : "failed", code);
            broadcastTrace(next.value.options.traceId);
        }
        if (next.value.options?.routineId) {
            const threadId = store.bot(botId)?.threadId ?? "";
            const active = routineRunsByThread.get(threadId);
            routineRunsByThread.delete(threadId);
            finishRoutineRunFailure(next.value.options.routineId, active?.runId ?? "", error instanceof Error ? error.message : String(error));
        }
        const bot = store.bot(botId);
        if (bot) {
            const raw = error instanceof Error ? error.message : String(error);
            const safe = /^(所有可用候选|没有可用的 Agent|所有候选均已尝试)/.test(raw)
                ? raw.slice(0, 180)
                : `任务启动失败：${providerErrorLabel(classifyProviderError(error).code)}`;
            const message = store.appendMessage(bot.threadId, {
                role: "bot",
                kind: "activity",
                tool: { name: safe, ok: false },
                routing: { status: "failed", reason: classifyProviderError(error).code },
            });
            broadcast({ kind: "message", threadId: bot.threadId, message });
        }
        finishScheduledTurn(botId);
    }
}
async function startTurn(botId, text, opts) {
    const bot = store.bot(botId);
    if (!bot)
        throw Object.assign(new Error("no such bot"), { status: 404 });
    if ((bot.routingMode ?? "manual") === "manual" && !registry.get(bot.modelSelection.instanceId)) {
        throw Object.assign(new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`), { status: 409 });
    }
    if (!opts?.userMessage) {
        const message = store.appendMessage(bot.threadId, { role: "user", kind: "text", text, ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}) });
        broadcast({ kind: "message", threadId: bot.threadId, message });
        opts = { ...opts, userMessage: message };
    }
    if (!opts?.traceId) {
        const trace = taskTraces.create({ threadId: bot.threadId, botId, userMessageId: opts?.userMessage?.id });
        opts = { ...opts, traceId: trace.id };
        broadcast({ kind: "trace", trace: wireTrace(trace) });
    }
    turnScheduler.enqueue(botId, { text, options: opts }, opts?.routineId || opts?.commsDepth ? "background" : "normal");
    store.patchBot(botId, { busy: true, unread: false });
    broadcastBot(store.bot(botId));
    if (!turnScheduler.isActive(botId))
        void drainBotQueue(botId);
    return { queued: true, queueDepth: turnScheduler.depth(botId) - (turnScheduler.isActive(botId) ? 1 : 0), traceId: opts.traceId };
}
async function runRoutine(routineId) {
    const routine = store.routine(routineId);
    if (!routine)
        return { queued: false, reason: "no such routine" };
    if (!store.bot(routine.botId))
        return { queued: false, reason: "no such bot" };
    if (routine.lastStatus === "running" || routine.lastStatus === "queued") {
        return { queued: false, reason: "routine is already running" };
    }
    const bot = store.bot(routine.botId);
    // A routine never jumps ahead of a human turn and never creates a second
    // computer/session assumption. The next scheduler tick will retry safely.
    if (bot.busy || turnScheduler.isActive(bot.id) || turnScheduler.hasPending(bot.id)) {
        return { queued: false, reason: "bot is busy" };
    }
    const runId = newId();
    const now = Date.now();
    const history = [{ id: runId, startedAt: now, status: "running" }, ...routine.history].slice(0, 20);
    store.patchRoutine(routine.id, {
        lastStatus: "running",
        lastRunAt: now,
        lastError: undefined,
        history,
    });
    broadcastRoutine(routine.id);
    routineRunsByThread.set(bot.threadId, { routineId: routine.id, runId });
    try {
        await startTurn(bot.id, routine.prompt, { routineId: routine.id });
        return { queued: true };
    }
    catch (error) {
        routineRunsByThread.delete(bot.threadId);
        finishRoutineRunFailure(routine.id, runId, error instanceof Error ? error.message : String(error));
        return { queued: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
function finishRoutineRunFailure(routineId, runId, message) {
    const routine = store.routine(routineId);
    if (!routine)
        return;
    const now = Date.now();
    const run = routine.history.find((entry) => entry.id === runId);
    if (run) {
        run.status = "failed";
        run.finishedAt = now;
        run.error = message.slice(0, 500);
    }
    store.patchRoutine(routine.id, {
        lastStatus: "failed", lastError: message.slice(0, 500), runCount: routine.runCount + 1,
        nextRunAt: now + routine.intervalMinutes * 60_000, history: routine.history.slice(0, 20),
    });
    broadcastRoutine(routine.id);
}
function scheduleDueRoutines() {
    const now = Date.now();
    for (const routine of store.routinesFor()) {
        if (!routine.enabled || routine.lastStatus === "running" || routine.lastStatus === "queued" || routine.nextRunAt > now)
            continue;
        void runRoutine(routine.id);
    }
}
// ── config hot-reload ─────────────────────────────────────────────────
// ── group turn engine ──────────────────────────────────────────────────
// Room messages go to the configured default responder unless the user
// explicitly @mentions members. Responders run SEQUENTIALLY (one speaker at
// a time — the transcript and streaming bubble stay coherent), each on a
// fresh session with recent room context. A member's reply may @mention
// teammates; those get one chained turn (hop 1), never deeper.
const groupQueues = new Map();
const GROUP_CONTEXT_MESSAGES = 30;
const MAX_GROUP_HOPS = 1;
function serializeRoomContext(threadId, userName) {
    return store
        .messagesFor(threadId)
        .filter((m) => m.kind === "text" && m.text)
        .slice(-GROUP_CONTEXT_MESSAGES)
        .map((m) => `${m.role === "user" ? userName : (m.from?.name ?? "Bot")}${m.replyTo ? `（回复：${m.replyTo.text.slice(0, 240)}）` : ""}: ${m.text}`)
        .join("\n");
}
function broadcastGroup(groupId) {
    const group = store.group(groupId);
    if (group)
        broadcast({ kind: "group", group });
}
async function groupTurnIntegrations(bot, instance, providerThreadId, taskText, commsContext) {
    const integrations = {};
    if (cfg.composio?.key)
        integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
    const managedMcp = mcp.activeMcpIntegrations(cfg, bot.id);
    if (managedMcp.length)
        integrations.mcp = managedMcp;
    if (instance.adapter.capabilities.agentsMcp === true &&
        store.bots.some((candidate) => candidate.id !== bot.id && !candidate.hidden))
        integrations.agents = agentsIntegration(bot.id, commsContext);
    // Room responders use a computer only when the user explicitly configured
    // one. Chat-only responders stay entirely outside the Box lane.
    if (bot.computer === "cloud") {
        const refusal = computerControlRefusal(effectiveComputerControl(bot.id));
        if (refusal)
            throw new Error(refusal);
        if (!instance.adapter.capabilities.computerMode)
            throw new Error("当前 Agent 不支持云电脑操作");
        if (!box.boxConfigured(cfg))
            throw new Error("尚未配置 Box 令牌，无法启动云端电脑");
        let cloud = await box.findBox(cfg, bot.id).catch(() => null);
        if (!cloud) {
            if (!box.automaticBoxCreationEnabled(cfg))
                throw new Error("未找到云端电脑，且已禁止自动创建");
            await box.provisionBox(cfg, bot.id, bot.name, (state) => broadcast({ kind: "computer", botId: bot.id, state }));
            cloud = await box.findBox(cfg, bot.id).catch(() => null);
        }
        if (!cloud)
            throw new Error("云端电脑不可用");
        if (!["idle", "ready", "running"].includes(cloud.state)) {
            cloud = (await box.readyBox(cfg, bot.id).catch(() => null)) ?? cloud;
        }
        if (!["idle", "ready", "running"].includes(cloud.state))
            throw new Error(`云端电脑当前状态为 ${cloud.state ?? "unknown"}`);
        botBoxIds.set(bot.id, cloud.id);
        integrations.computer = {
            boxId: cloud.id,
            token: cfg.box.token,
            control: {
                botId: bot.id,
                url: `http://127.0.0.1:${PORT}/api/internal/computer-control/${encodeURIComponent(bot.id)}`,
                token: COMMS_TOKEN,
            },
        };
        const leaseAbort = new AbortController();
        pendingCloudLeaseByThread.set(providerThreadId, leaseAbort);
        let release;
        try {
            release = await cloudComputerLeases.acquire(cloud.id, () => {
                broadcast({ kind: "computer", botId: bot.id, state: "waiting" });
                broadcastComputerLease(cloud.id);
            }, leaseAbort.signal, { botId: bot.id, task: taskText.slice(0, 160) });
        }
        finally {
            pendingCloudLeaseByThread.delete(providerThreadId);
        }
        cloudLeaseByThread.set(providerThreadId, release);
        cloudLeaseBoxByThread.set(providerThreadId, cloud.id);
        broadcastComputerLease(cloud.id);
    }
    else if (bot.computer === "local") {
        const refusal = computerControlRefusal(effectiveComputerControl(bot.id));
        if (refusal)
            throw new Error(refusal);
        if (instance.adapter.capabilities.computerMode !== "mcp")
            throw new Error("当前 Agent 不支持本地电脑操作");
        const local = readCuaConnection();
        if (!local)
            throw new Error("本地电脑连接不可用");
        integrations.localComputer = local;
    }
    return integrations;
}
async function runGroupMemberTurn(groupId, botId, hop, 
// bots that already spoke for this user message — "@Scout ask @Pixel"
// must not run Pixel twice (once chained, once as a direct responder)
reasoningLevel, spoken = new Set()) {
    const group = store.group(groupId);
    const bot = store.bot(botId);
    if (!group || !bot)
        return;
    spoken.add(botId);
    const userName = cfg.profile?.name?.trim() || "User";
    markGroupBusy(group, bot.id);
    const speaker = { botId: bot.id, name: bot.name, color: bot.color };
    const roster = group.memberIds
        .map((id) => store.bot(id))
        .filter((b) => Boolean(b))
        .map((b) => `@${b.name}${b.title ? ` (${b.title})` : ""}`)
        .join(", ");
    const system = [
        `You are ${bot.name}, a bot in the room "${group.name}" in XinyunOpen Bot.`,
        bot.title && `Role: ${bot.title}.`,
        bot.description && `About: ${bot.description}`,
        `Room members: ${roster}, and ${userName} (the human).`,
        group.bulletin.trim() && `Room bulletin (shared instructions for everyone):\n${group.bulletin.trim()}`,
        `Reply as yourself, briefly and conversationally. To bring a teammate in, mention them like @Name — they'll see the conversation and respond.`,
    ]
        .filter(Boolean)
        .join("\n");
    const text = `${serializeRoomContext(group.threadId, userName)}\n\n(Reply to the conversation above as ${bot.name}.)`;
    const commsContext = {
        rootTurnId: newId(),
        sourceTurnId: newId(),
        depth: 0,
        handoffCount: 0,
        visitedBots: [bot.id],
    };
    const groupTrace = taskTraces.create({ threadId: group.threadId, botId: bot.id });
    taskTraces.start(groupTrace.id, commsContext.rootTurnId);
    broadcastTrace(groupTrace.id);
    let plan;
    try {
        plan = await createRoutingPlan(bot, text);
    }
    catch (error) {
        const code = classifyProviderError(error).code;
        taskTraces.finish(groupTrace.id, code === "cancelled" ? "cancelled" : "failed", code);
        broadcastTrace(groupTrace.id);
        appendRoutingActivity(group.threadId, {
            role: "bot",
            kind: "activity",
            from: speaker,
            tool: { name: `error: ${providerErrorLabel(classifyProviderError(error).code)}`, ok: false },
            routing: { status: "failed", reason: classifyProviderError(error).code },
        });
        markGroupIdle(group, bot.id);
        return;
    }
    const reasoningEffort = reasoningEffortForLevel(reasoningLevel);
    let replyText = "";
    let first = true;
    for (;;) {
        const candidate = plan.candidates.find((value) => !plan.attempted.includes(candidateKey(value)));
        if (!candidate)
            break;
        const instance = registry.get(candidate.instanceId);
        if (!instance) {
            plan.attempted.push(candidateKey(candidate));
            continue;
        }
        if (first && plan.mode !== "manual") {
            appendRoutingActivity(group.threadId, {
                role: "bot",
                kind: "activity",
                from: speaker,
                tool: { name: `已为 ${bot.name} 选择 ${candidate.modelLabel}`, ok: true },
                routing: { status: "selecting", to: selectionFor(candidate) },
            });
        }
        first = false;
        // The preferred candidate keeps the stable room/bot provider session.
        // A replacement gets an isolated thread so a late terminal event from
        // the failed engine cannot settle or append output to the replacement.
        const providerThreadId = plan.attempted.length === 0
            ? `group:${group.threadId}:${bot.id}`
            : `group:${group.threadId}:${bot.id}:failover:${plan.attempted.length}`;
        groupTurnContexts.set(providerThreadId, {
            groupThreadId: group.threadId,
            groupId: group.id,
            botId: bot.id,
            instanceId: instance.instanceId,
            speaker,
        });
        const turnModel = modelForReasoningLevel(instance.models, candidate.model, reasoningLevel);
        plan.attempted.push(candidateKey(candidate));
        taskTraces.attempt(groupTrace.id, { instanceId: instance.instanceId, model: turnModel });
        broadcastTrace(groupTrace.id);
        let integrations;
        try {
            integrations = await groupTurnIntegrations(bot, instance, providerThreadId, text, commsContext);
        }
        catch (integrationError) {
            releaseCloudLease(providerThreadId);
            groupTurnContexts.delete(providerThreadId);
            const error = classifyProviderError(integrationError);
            if (error.code !== "cancelled") {
                appendRoutingActivity(group.threadId, {
                    role: "bot",
                    kind: "activity",
                    from: speaker,
                    tool: { name: `任务启动失败：${providerErrorLabel(error.code)}`, ok: false },
                    routing: { status: "failed", reason: error.code, attempts: attemptedSelections(plan) },
                });
            }
            cancelledGroupTurns.delete(providerThreadId);
            taskTraces.finish(groupTrace.id, error.code === "cancelled" ? "cancelled" : "failed", error.code);
            broadcastTrace(groupTrace.id);
            break;
        }
        if (integrations.computer || integrations.localComputer) {
            taskTraces.computer(groupTrace.id, integrations.computer ? "获得云电脑串行使用权" : "使用本地电脑");
            broadcastTrace(groupTrace.id);
        }
        const attempt = providerHealth.startAttempt(instance.instanceId, turnModel);
        const result = await new Promise((resolve) => {
            let done = false;
            let lastError;
            let timedOut = false;
            let outputProduced = false;
            let externalSideEffect = false;
            let attemptText = "";
            const finish = (value) => {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                unsub();
                resolve({ ...value, outputProduced, externalSideEffect, text: attemptText });
            };
            const unsub = bus.subscribe((event) => {
                if (event.threadId !== providerThreadId || event.providerInstanceId !== instance.instanceId)
                    return;
                if (taskTraces.runtime(groupTrace.id, event))
                    broadcastTrace(groupTrace.id);
                if (event.type === "item.started" && event.itemType === "tool")
                    externalSideEffect = true;
                else if (event.type === "item.completed" && event.itemType === "assistant_text" && event.text.trim()) {
                    outputProduced = true;
                    attemptText += `\n${event.text}`;
                }
                else if (event.type === "runtime.error")
                    lastError = classifyProviderError(event.message);
                else if (event.type === "turn.completed") {
                    const cancelled = cancelledGroupTurns.delete(providerThreadId);
                    finish({
                        ok: event.ok,
                        ...(event.ok ? {} : {
                            error: cancelled
                                ? classifyProviderError("cancelled by user")
                                : timedOut
                                    ? classifyProviderError("group turn timeout")
                                    : lastError ?? classifyProviderError(event.stopReason ?? "turn failed"),
                        }),
                    });
                }
            });
            const timer = setTimeout(() => {
                timedOut = true;
                void instance.adapter.interruptTurn(providerThreadId)
                    .catch(() => { })
                    .finally(() => finish({ ok: false, error: classifyProviderError("group turn timeout") }));
            }, 5 * 60_000);
            instance.adapter.sendTurn({
                threadId: providerThreadId,
                text,
                system,
                permissionMode: bot.autoApprove ? "auto" : "ask",
                model: turnModel,
                reasoningEffort,
                integrations,
            }).catch((error) => finish({ ok: false, error: classifyProviderError(error) }));
        });
        releaseCloudLease(providerThreadId);
        groupTurnContexts.delete(providerThreadId);
        cancelledGroupTurns.delete(providerThreadId);
        replyText += result.text;
        if (result.ok) {
            providerHealth.recordSuccess(attempt);
            taskTraces.finish(groupTrace.id, "completed");
            broadcastTrace(groupTrace.id);
            break;
        }
        const error = result.error ?? classifyProviderError("turn failed");
        if (error.code === "cancelled")
            providerHealth.recordCancelled(attempt);
        else
            providerHealth.recordFailure(attempt, error);
        const next = nextFailoverCandidate({
            candidates: plan.candidates,
            attempted: plan.attempted,
            maxFailovers: plan.maxFailovers,
            cancelled: error.code === "cancelled",
            externalSideEffect: result.externalSideEffect,
            // Group computer responders remain in their serialized lane and are
            // never replayed on another engine, even if no tool event was emitted.
            computerAction: bot.computer === "cloud" || bot.computer === "local",
            outputProduced: result.outputProduced,
        }, error);
        if (!next.candidate) {
            if (error.code !== "cancelled") {
                appendRoutingActivity(group.threadId, {
                    role: "bot",
                    kind: "activity",
                    from: speaker,
                    tool: { name: `所有可用候选均失败：${providerErrorLabel(error.code)}`, ok: false },
                    routing: { status: "failed", reason: error.code, attempts: attemptedSelections(plan) },
                });
            }
            taskTraces.finish(groupTrace.id, error.code === "cancelled" ? "cancelled" : "failed", error.code);
            broadcastTrace(groupTrace.id);
            break;
        }
        const from = selectionFor(candidate);
        const to = selectionFor(next.candidate);
        taskTraces.failover(groupTrace.id, from, to, error.code);
        broadcastTrace(groupTrace.id);
        appendRoutingActivity(group.threadId, {
            role: "bot",
            kind: "activity",
            from: speaker,
            tool: { name: `${candidate.modelLabel} ${providerErrorLabel(error.code)}，已切换到 ${next.candidate.modelLabel}`, ok: true },
            routing: { status: "failover", from, to, reason: error.code },
        });
        store.patchBot(bot.id, { lastFailover: { at: Date.now(), from, to, reason: error.code } });
        broadcastBot(store.bot(bot.id));
    }
    if (first) {
        taskTraces.finish(groupTrace.id, "failed", "temporarily_unavailable");
        broadcastTrace(groupTrace.id);
        appendRoutingActivity(group.threadId, {
            role: "bot",
            kind: "activity",
            from: speaker,
            tool: { name: `所有可用候选均失败：${bot.name} 的模型不可用`, ok: false },
            routing: { status: "failed", reason: "temporarily_unavailable", attempts: attemptedSelections(plan) },
        });
    }
    markGroupIdle(group, bot.id);
    store.patchGroup(group.id, { unread: true });
    broadcastGroup(group.id);
    // chained mentions: a member's reply can summon teammates — one hop only
    if (hop < MAX_GROUP_HOPS && replyText.trim()) {
        const members = group.memberIds
            .map((id) => store.bot(id))
            .filter((b) => Boolean(b) && b.id !== bot.id);
        for (const next of roomResponders(replyText, members, { kind: "mentions" })) {
            if (spoken.has(next.id))
                continue;
            await runGroupMemberTurn(groupId, next.id, hop + 1, reasoningLevel, spoken);
        }
    }
}
function startGroupTurn(groupId, text, reasoningLevel, replyTo) {
    const group = store.group(groupId);
    if (!group)
        throw Object.assign(new Error("no such group"), { status: 404 });
    const userMessage = store.appendMessage(group.threadId, { role: "user", kind: "text", text, ...(replyTo ? { replyTo } : {}) });
    broadcast({ kind: "message", threadId: group.threadId, message: userMessage });
    const members = group.memberIds
        .map((id) => store.bot(id))
        .filter((b) => Boolean(b));
    let responders = roomResponders(text, members, group.defaultResponder);
    // bot⇄bot channels: chipping in without a tag addresses the last speaker
    if (!responders.length && group.dm) {
        const lastSpeakerId = [...store.messagesFor(group.threadId)]
            .reverse()
            .find((msg) => msg.kind === "text" && msg.from)?.from?.botId;
        const last = members.find((b) => b.id === lastSpeakerId) ?? members[0];
        responders = last ? [last] : [];
    }
    if (!responders.length)
        return;
    const prev = groupQueues.get(groupId) ?? Promise.resolve();
    const next = prev.then(async () => {
        const spoken = new Set();
        const unique = responders.filter((responder, index) => responders.findIndex((candidate) => candidate.id === responder.id) === index);
        const parallel = [];
        const serialized = [];
        for (const responder of unique) {
            // A configured computer turn must stay in the Box lane. Chat-only
            // responders do not share that physical resource and can run together.
            const explicitComputer = responder.computer === "cloud" || responder.computer === "local";
            const needsComputer = explicitComputer;
            (needsComputer ? serialized : parallel).push(responder);
        }
        await Promise.all(parallel.map((responder) => runGroupMemberTurn(groupId, responder.id, 0, reasoningLevel, spoken)));
        for (const responder of serialized) {
            if (spoken.has(responder.id))
                continue;
            await runGroupMemberTurn(groupId, responder.id, 0, reasoningLevel, spoken);
        }
    });
    groupQueues.set(groupId, next.catch(() => { }));
}
function configStatus() {
    return {
        xai: { configured: Boolean(cfg.xai?.key) },
        gemini: { configured: Boolean(cfg.gemini?.key) },
        anthropic: { configured: Boolean(cfg.anthropic?.key) },
        openai: { configured: Boolean(cfg.openai?.key) },
        domestic: Object.fromEntries(DOMESTIC_PROVIDER_IDS.map((providerId) => [
            providerId,
            { configured: Boolean(cfg.domestic?.[providerId]?.key) },
        ])),
        composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
        box: { configured: Boolean(cfg.box?.token) },
        voice: describeVoice(cfg),
        profile: { name: cfg.profile?.name ?? "", email: cfg.profile?.email ?? "" },
    };
}
/** Rebuild the provider fleet after a config change so new keys take
 * effect without a server restart (kills any in-flight turns). */
async function reloadProviders() {
    bus.detachAll();
    await registry.disposeAll();
    await registry.load(instanceConfigs(cfg));
    bus.attach(registry.instances());
    // A killed turn's terminal events can die with the old fleet (dispose is
    // async under the hood), stranding the bot busy — and its screen poller —
    // forever. Settle anything still marked busy.
    for (const b of store.bots.filter((b) => b.busy)) {
        pendingCloudLeaseByThread.get(b.threadId)?.abort();
        pendingCloudLeaseByThread.delete(b.threadId);
        releaseCloudLease(b.threadId);
        stopScreenPoller(b.id);
        const note = store.appendMessage(b.threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: "error: turn interrupted — provider settings changed", ok: false },
        });
        broadcast({ kind: "message", threadId: b.threadId, message: note });
        store.patchBot(b.id, { busy: false });
        broadcastBot(store.bot(b.id));
    }
}
// ── HTTP plumbing ─────────────────────────────────────────────────────
function json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(data);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => {
            data += c;
            if (data.length > 1_000_000)
                reject(new Error("body too large"));
        });
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            }
            catch {
                reject(new Error("invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}
function readBytes(req, maxBytes = 25_000_000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        const fail = (message, status) => {
            if (settled)
                return;
            settled = true;
            const error = new Error(message);
            error.status = status;
            reject(error);
        };
        req.on("data", (chunk) => {
            if (settled)
                return;
            total += chunk.length;
            if (total > maxBytes) {
                fail("录音文件过大", 413);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (settled)
                return;
            settled = true;
            resolve(new Uint8Array(Buffer.concat(chunks)));
        });
        req.on("error", (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        });
    });
}
function requestHostName(host) {
    if (!host)
        return null;
    const value = host.trim().toLowerCase();
    if (value.startsWith("[")) {
        const end = value.indexOf("]");
        return end > 0 ? value.slice(1, end) : null;
    }
    return value.split(":", 1)[0] || null;
}
function isLoopbackHost(host) {
    const hostname = requestHostName(host);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    try {
        const parsed = new URL(origin);
        return ((parsed.protocol === "http:" || parsed.protocol === "https:") &&
            isLoopbackHost(parsed.hostname));
    }
    catch {
        return false;
    }
}
const server = createServer(async (req, res) => {
    if (!isLoopbackHost(req.headers.host)) {
        return json(res, 403, { error: "forbidden: loopback host required" });
    }
    if (!isAllowedOrigin(req.headers.origin)) {
        return json(res, 403, { error: "forbidden: cross-origin request" });
    }
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
        // ── internal peer-agent comms (localhost + shared token only) ──────
        // The agents-proxy (spawned inside a bot's agent process) calls these to
        // discover peers and hand a message to one. Not part of the public API.
        if (path.startsWith("/api/internal/")) {
            if (req.headers.authorization !== `Bearer ${COMMS_TOKEN}`) {
                return json(res, 401, { error: "unauthorized" });
            }
            const controlMatch = path.match(/^\/api\/internal\/computer-control\/([\w-]+)$/);
            if (controlMatch && (method === "GET" || method === "POST" || method === "DELETE")) {
                const botId = controlMatch[1];
                if (!store.bot(botId))
                    return json(res, 404, { error: "no such bot" });
                if (method === "GET")
                    return json(res, 200, effectiveComputerControl(botId));
                const body = await readBody(req);
                const snapshot = method === "POST"
                    ? computerControl.requestHelp(botId, body.reason)
                    : computerControl.expireHelp(botId, String(body.requestId ?? ""));
                broadcastComputerControl(botId);
                return json(res, 200, snapshot);
            }
            if (method === "GET" && path === "/api/internal/agents") {
                const self = url.searchParams.get("self");
                // title/description included so a "chief of staff"-style bot can
                // judge the team (who does what, who has no job description yet)
                const bots = store.bots
                    .filter((b) => b.id !== self && !b.hidden)
                    .map((b) => ({
                    id: b.id,
                    name: b.name,
                    model: b.modelSelection.model,
                    busy: !!b.busy,
                    title: b.title || undefined,
                    description: b.description || undefined,
                }));
                return json(res, 200, { bots });
            }
            if (method === "POST" && path === "/api/internal/ask-bot") {
                const body = await readBody(req);
                const fromBotId = String(body.fromBotId ?? "");
                const toBotId = String(body.toBotId ?? "");
                const message = String(body.message ?? "").trim();
                const depth = Number(body.depth ?? 0) || 0;
                const handoffCount = Number(body.handoffCount ?? 0) || 0;
                const rootTurnId = String(body.rootTurnId ?? "").trim() || newId();
                const sourceTurnId = String(body.sourceTurnId ?? "").trim() || newId();
                const visitedBots = Array.isArray(body.visitedBots)
                    ? body.visitedBots.filter((id) => typeof id === "string" && id.length > 0)
                    : [];
                if (!toBotId || !message)
                    return json(res, 400, { error: "toBotId and message required" });
                if (toBotId === fromBotId)
                    return json(res, 400, { error: "a bot cannot message itself" });
                if (depth >= MAX_COMMS_DEPTH)
                    return json(res, 200, { error: `message chains are limited to ${MAX_COMMS_DEPTH} hops` });
                if (handoffCount >= MAX_HANDOFFS_PER_ROOT)
                    return json(res, 200, { error: `handoff budget exhausted (${MAX_HANDOFFS_PER_ROOT})` });
                if (visitedBots.includes(toBotId))
                    return json(res, 200, { error: "handoff cycle detected: target bot already visited" });
                const normalizedVisitedBots = [...new Set([...visitedBots, fromBotId])];
                const dedupeKey = `${rootTurnId}:${fromBotId}:${toBotId}:${message}`;
                const previous = recentHandoffKeys.get(dedupeKey);
                if (previous && Date.now() - previous.createdAt < HANDOFF_DEDUPE_WINDOW_MS) {
                    return json(res, 202, { handoffId: previous.handoffId, status: "queued", deduped: true });
                }
                for (const [key, item] of recentHandoffKeys) {
                    if (Date.now() - item.createdAt >= HANDOFF_DEDUPE_WINDOW_MS)
                        recentHandoffKeys.delete(key);
                }
                const target = store.bot(toBotId);
                if (!target)
                    return json(res, 404, { error: "no such bot" });
                const from = store.bot(fromBotId);
                const fromName = from?.name ?? "another bot";
                // the exchange is mirrored into a bot⇄bot channel: it shows up in
                // the sidebar like any room, keeps the pair's full history, and the
                // user can open it and chip in
                let channel = from ? store.dmGroup(from.id, target.id) : undefined;
                if (from && !channel) {
                    channel = store.createGroup(`${from.name} ⇄ ${target.name}`, [from.id, target.id], true);
                }
                const mirror = (speaker, text) => {
                    if (!channel || !text.trim())
                        return;
                    const msg = store.appendMessage(channel.threadId, {
                        role: "bot",
                        kind: "text",
                        text,
                        from: { botId: speaker.id, name: speaker.name, color: speaker.color },
                    });
                    broadcast({ kind: "message", threadId: channel.threadId, message: msg });
                };
                // both 1:1 threads get a clickable chip that opens the channel, so
                // bot-to-bot turns are never invisible (they cost the user tokens)
                const chip = (threadId, label, withBot) => {
                    const note = store.appendMessage(threadId, {
                        role: "bot",
                        kind: "activity",
                        tool: { name: label },
                        comm: channel
                            ? { groupId: channel.id, withBotId: withBot.id, withName: withBot.name, withColor: withBot.color }
                            : undefined,
                    });
                    broadcast({ kind: "message", threadId, message: note });
                };
                if (from) {
                    mirror(from, message);
                    chip(from.threadId, `Messaged @${target.name}`, target);
                    chip(target.threadId, `Message from @${from.name}`, from);
                    if (channel) {
                        store.patchGroup(channel.id, { unread: true });
                        broadcastGroup(channel.id);
                    }
                }
                const prefixed = `[Message from @${fromName}, another bot in this XinyunOpen Bot workspace. Reply to them.]\n\n${message}`;
                const handoff = {
                    id: newId(),
                    fromBotId,
                    toBotId,
                    status: "queued",
                    createdAt: Date.now(),
                    rootTurnId,
                    sourceTurnId,
                    groupId: channel?.id,
                    depth: depth + 1,
                    handoffCount: handoffCount + 1,
                    visitedBots: [...normalizedVisitedBots, toBotId],
                };
                handoffs.set(handoff.id, handoff);
                const parentTrace = taskTraces.findByRootTurn(rootTurnId);
                if (parentTrace) {
                    taskTraces.handoff(parentTrace.id, `交接给 ${target.name}`);
                    broadcastTrace(parentTrace.id);
                }
                recentHandoffKeys.set(dedupeKey, { handoffId: handoff.id, createdAt: handoff.createdAt });
                broadcast({ kind: "handoff", handoff });
                void (async () => {
                    handoff.status = "running";
                    broadcast({ kind: "handoff", handoff });
                    const reply = await askBotAndWait(toBotId, prefixed, {
                        rootTurnId,
                        sourceTurnId,
                        depth,
                        handoffCount: handoffCount + 1,
                        visitedBots: normalizedVisitedBots,
                    });
                    handoff.targetTurnId = reply.targetTurnId;
                    const failed = reply.text.startsWith("(couldn't") || reply.text.startsWith("(timed out");
                    handoff.status = failed ? "failed" : "completed";
                    handoff.result = reply.text;
                    if (failed)
                        handoff.error = reply.text;
                    handoff.finishedAt = Date.now();
                    if (parentTrace) {
                        taskTraces.handoff(parentTrace.id, `${target.name} 交接${failed ? "失败" : "完成"}`, !failed, handoff.finishedAt - handoff.createdAt);
                        broadcastTrace(parentTrace.id);
                    }
                    if (from) {
                        mirror(target, reply.text);
                        chip(from.threadId, `@${target.name} 已完成交接`, target);
                        if (channel) {
                            store.patchGroup(channel.id, { unread: true });
                            broadcastGroup(channel.id);
                        }
                    }
                    broadcast({ kind: "handoff", handoff });
                })();
                return json(res, 202, { handoffId: handoff.id, status: handoff.status, botName: target.name });
            }
            return json(res, 404, { error: "unknown internal endpoint" });
        }
        // ── events stream ──
        if (method === "GET" && path === "/api/events") {
            const client = { res, screens: url.searchParams.get("screens") !== "off" };
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            const replay = sseReplay.resume(url.searchParams.get("since") ?? req.headers["last-event-id"], (kind) => wantsSseKind(client, kind));
            res.write(`data: ${JSON.stringify({ kind: "hello", cursor: replay.cursor, resumed: replay.resumed })}\n\n`);
            for (const frame of replay.frames)
                res.write(frame);
            sseClients.add(client);
            const keepalive = setInterval(() => {
                try {
                    res.write(": keepalive\n\n");
                }
                catch { }
            }, 25_000);
            req.on("close", () => {
                clearInterval(keepalive);
                sseClients.delete(client);
            });
            return;
        }
        // Redacted operational traces. Replay deliberately resolves the source
        // from the transcript instead of persisting user text in diagnostics.
        if (method === "GET" && path === "/api/traces") {
            const threadId = url.searchParams.get("threadId") ?? undefined;
            return json(res, 200, { traces: taskTraces.list(threadId, Number(url.searchParams.get("limit") ?? 30)).map(wireTrace) });
        }
        let traceMatch = path.match(/^\/api\/traces\/([\w-]+)$/);
        if (traceMatch && method === "GET") {
            const trace = taskTraces.get(traceMatch[1]);
            return trace ? json(res, 200, { trace: wireTrace(trace) }) : json(res, 404, { error: "未找到运行追踪" });
        }
        traceMatch = path.match(/^\/api\/traces\/([\w-]+)\/export$/);
        if (traceMatch && method === "GET") {
            const diagnostic = taskTraces.export(traceMatch[1]);
            return diagnostic ? json(res, 200, diagnostic) : json(res, 404, { error: "未找到运行追踪" });
        }
        traceMatch = path.match(/^\/api\/traces\/([\w-]+)\/replay$/);
        if (traceMatch && method === "POST") {
            const replay = taskTraces.canReplay(traceMatch[1]);
            if (!replay.ok || !replay.trace)
                return json(res, 409, { error: replay.reason });
            const bot = store.bot(replay.trace.botId);
            if (!bot || bot.threadId !== replay.trace.threadId)
                return json(res, 409, { error: "原任务已不在当前会话中" });
            const source = store.messagesFor(bot.threadId).find((message) => message.id === replay.trace.userMessageId);
            if (!source || source.role !== "user" || source.kind !== "text" || !source.text?.trim()) {
                return json(res, 409, { error: "原始文本消息已不可用" });
            }
            const queued = await startTurn(bot.id, source.text, { replyTo: source.replyTo });
            return json(res, 202, { ok: true, ...queued });
        }
        // Image attachments are stored outside the transcript and referenced by
        // generated filenames, so prompt paths never expose an original name.
        if (method === "POST" && path === "/api/attachments") {
            const rawType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
            const mime = rawType?.split(";")[0]?.trim().toLowerCase();
            if (!mime || !extensionForMime(mime))
                return json(res, 400, { error: "content-type must be a supported image type" });
            const saved = await new Promise((resolve, reject) => {
                const chunks = [];
                let received = 0;
                let settled = false;
                const fail = (status, message) => {
                    if (settled)
                        return;
                    settled = true;
                    reject(Object.assign(new Error(message), { status }));
                };
                req.on("data", (chunk) => {
                    if (settled)
                        return;
                    received += chunk.byteLength;
                    if (received > IMAGE_MAX_BYTES)
                        return fail(413, `image exceeds ${IMAGE_MAX_BYTES} bytes`);
                    chunks.push(chunk);
                });
                req.on("end", () => {
                    if (settled)
                        return;
                    settled = true;
                    try {
                        resolve(saveImage(Buffer.concat(chunks), mime));
                    }
                    catch (error) {
                        reject(error);
                    }
                });
                req.on("error", (error) => fail(400, error instanceof Error ? error.message : String(error)));
            });
            return json(res, 201, saved);
        }
        const attachmentMatch = path.match(/^\/api\/attachments\/([\w.-]+)$/);
        if (method === "GET" && attachmentMatch) {
            const attachment = readAttachment(attachmentMatch[1]);
            if (!attachment)
                return json(res, 404, { error: "no such attachment" });
            res.writeHead(200, {
                "content-type": attachment.mime,
                "content-length": String(attachment.bytes.byteLength),
                "cache-control": "private, max-age=31536000, immutable",
                "x-content-type-options": "nosniff",
            });
            return res.end(attachment.bytes);
        }
        // Global palette search. It is intentionally read-only and scans only
        // persisted text messages; screenshots, tool payloads and credentials
        // never enter the result set.
        if (method === "GET" && path === "/api/search") {
            const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
            const normalized = query.toLocaleLowerCase();
            const requestedLimit = Number(url.searchParams.get("limit") ?? 12);
            const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 12));
            if (!normalized)
                return json(res, 200, { hits: [] });
            const snippet = (text) => {
                const lower = text.toLocaleLowerCase();
                const match = lower.indexOf(normalized);
                const start = Math.max(0, match - 50);
                const end = Math.min(text.length, match + query.length + 90);
                const compact = text.slice(start, end).replace(/\s+/g, " ").trim();
                return `${start > 0 ? "…" : ""}${compact}${end < text.length ? "…" : ""}`;
            };
            const hits = [];
            for (const bot of store.bots) {
                if (bot.hidden)
                    continue;
                for (const task of store.tasks(bot.id)) {
                    for (const message of store.messagesFor(task.threadId)) {
                        if (message.kind !== "text" || !message.text?.toLocaleLowerCase().includes(normalized))
                            continue;
                        hits.push({
                            threadId: task.threadId,
                            messageId: message.id,
                            at: message.at,
                            role: message.role,
                            snippet: snippet(message.text),
                            name: bot.name,
                            botId: bot.id,
                            task: task.title,
                        });
                    }
                }
            }
            for (const group of store.groups) {
                for (const message of store.messagesFor(group.threadId)) {
                    if (message.kind !== "text" || !message.text?.toLocaleLowerCase().includes(normalized))
                        continue;
                    hits.push({
                        threadId: group.threadId,
                        messageId: message.id,
                        at: message.at,
                        role: message.role,
                        snippet: snippet(message.text),
                        name: group.name,
                        groupId: group.id,
                    });
                }
            }
            hits.sort((a, b) => b.at - a.at);
            return json(res, 200, { hits: hits.slice(0, limit) });
        }
        // ── bots ──
        if (method === "GET" && path === "/api/bots") {
            return json(res, 200, {
                bots: store.bots.map(wireBotWithThread),
                groups: store.groups.map((g) => ({ ...g, messages: store.messagesFor(g.threadId) })),
            });
        }
        // ── routines ───────────────────────────────────────────────────────
        if (method === "GET" && path === "/api/routines") {
            const botId = url.searchParams.get("botId") ?? undefined;
            return json(res, 200, { routines: store.routinesFor(botId).map(wireRoutine) });
        }
        if (method === "POST" && path === "/api/routines") {
            const body = await readBody(req);
            const botId = typeof body.botId === "string" ? body.botId : "";
            if (!store.bot(botId))
                return json(res, 404, { error: "no such bot" });
            const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
            const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 20_000) : "";
            const intervalMinutes = Number(body.intervalMinutes);
            if (!name || !prompt)
                return json(res, 400, { error: "name and prompt required" });
            if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
                return json(res, 400, { error: "intervalMinutes must be between 1 and 10080" });
            }
            const routine = store.createRoutine({ botId, name, prompt, enabled: body.enabled !== false, intervalMinutes: Math.trunc(intervalMinutes) });
            broadcastRoutine(routine.id);
            return json(res, 201, { routine: wireRoutine(routine) });
        }
        const routineMatch = path.match(/^\/api\/routines\/([\w-]+)$/);
        if (routineMatch && method === "PATCH") {
            const routine = store.routine(routineMatch[1]);
            if (!routine)
                return json(res, 404, { error: "no such routine" });
            const body = await readBody(req);
            const patch = {};
            if (body.name !== undefined)
                patch.name = String(body.name).trim().slice(0, 80);
            if (body.prompt !== undefined)
                patch.prompt = String(body.prompt).trim().slice(0, 20_000);
            if (body.enabled !== undefined) {
                if (typeof body.enabled !== "boolean")
                    return json(res, 400, { error: "enabled must be boolean" });
                patch.enabled = body.enabled;
            }
            if (body.intervalMinutes !== undefined) {
                const intervalMinutes = Number(body.intervalMinutes);
                if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
                    return json(res, 400, { error: "intervalMinutes must be between 1 and 10080" });
                }
                patch.intervalMinutes = Math.trunc(intervalMinutes);
                patch.nextRunAt = Date.now() + Math.trunc(intervalMinutes) * 60_000;
            }
            if (patch.name === "" || patch.prompt === "")
                return json(res, 400, { error: "name and prompt cannot be empty" });
            const updated = store.patchRoutine(routine.id, patch);
            broadcastRoutine(updated.id);
            return json(res, 200, { routine: wireRoutine(updated) });
        }
        if (routineMatch && method === "DELETE") {
            if (!store.deleteRoutine(routineMatch[1]))
                return json(res, 404, { error: "no such routine" });
            broadcastRoutine(routineMatch[1]);
            return json(res, 200, { ok: true });
        }
        const routineRunMatch = path.match(/^\/api\/routines\/([\w-]+)\/run$/);
        if (routineRunMatch && method === "POST") {
            const routine = store.routine(routineRunMatch[1]);
            if (!routine)
                return json(res, 404, { error: "no such routine" });
            const result = await runRoutine(routine.id);
            if (!result.queued)
                return json(res, 409, { error: result.reason ?? "routine could not start" });
            return json(res, 202, { ok: true, routine: wireRoutine(store.routine(routine.id)) });
        }
        // ── rooms (group chats) ─────────────────────────────────────────────
        let m = null;
        if (method === "POST" && path === "/api/groups") {
            const body = await readBody(req);
            const memberIds = (Array.isArray(body.memberIds) ? body.memberIds : []).filter((id) => typeof id === "string" && Boolean(store.bot(id)));
            if (memberIds.length === 0)
                return json(res, 400, { error: "a room needs at least one bot" });
            const name = typeof body.name === "string" && body.name.trim()
                ? body.name.trim()
                : `${store.bot(memberIds[0]).name} & co.`;
            const group = store.createGroup(name, memberIds);
            broadcast({ kind: "group", group });
            return json(res, 201, { group: { ...group, messages: [] } });
        }
        m = path.match(/^\/api\/groups\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const body = await readBody(req);
            const existing = store.group(m[1]);
            if (!existing)
                return json(res, 404, { error: "no such room" });
            const patch = {};
            for (const key of ["name", "bulletin", "unread"]) {
                if (body[key] !== undefined)
                    patch[key] = body[key];
            }
            if (Array.isArray(body.memberIds)) {
                if (existing.dm)
                    return json(res, 400, { error: "direct channels have fixed membership" });
                if (existing.busyBotId)
                    return json(res, 409, { error: "room membership cannot change while a bot is working" });
                const ids = [...new Set(body.memberIds.filter((id) => typeof id === "string" && Boolean(store.bot(id))))];
                if (!ids.length)
                    return json(res, 400, { error: "a room needs at least one bot" });
                patch.memberIds = ids;
            }
            if (body.defaultResponder !== undefined) {
                const value = body.defaultResponder;
                const memberIds = patch.memberIds ?? existing.memberIds;
                let responder = null;
                if (value?.kind === "everyone")
                    responder = { kind: "everyone" };
                else if (value?.kind === "mentions")
                    responder = { kind: "mentions" };
                else if (value?.kind === "member" && typeof value.botId === "string" && memberIds.includes(value.botId)) {
                    responder = { kind: "member", botId: value.botId };
                }
                if (!responder)
                    return json(res, 400, { error: "invalid default responder" });
                patch.defaultResponder = responder;
            }
            const group = store.patchGroup(m[1], patch);
            if (!group)
                return json(res, 404, { error: "no such room" });
            broadcast({ kind: "group", group });
            return json(res, 200, { group });
        }
        m = path.match(/^\/api\/groups\/([\w-]+)$/);
        if (m && method === "DELETE") {
            const group = store.group(m[1]);
            if (!group)
                return json(res, 404, { error: "no such room" });
            store.deleteGroup(group.id);
            for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
                try {
                    unlinkSync(join(dir, `${group.threadId}.ndjson`));
                }
                catch { }
            }
            broadcast({ kind: "group.deleted", groupId: group.id });
            return json(res, 200, { ok: true });
        }
        m = path.match(/^\/api\/groups\/([\w-]+)\/messages$/);
        if (m && method === "POST") {
            const body = await readBody(req);
            const text = String(body.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "text required" });
            const reasoningLevel = parseReasoningRequest(body.reasoningLevel, body.reasoningEffort);
            const group = store.group(m[1]);
            startGroupTurn(m[1], text, reasoningLevel, group ? replyReferenceForThread(group.threadId, body.replyTo) : undefined);
            return json(res, 202, { ok: true });
        }
        m = path.match(/^\/api\/groups\/([\w-]+)\/interrupt$/);
        if (m && method === "POST") {
            const group = store.group(m[1]);
            if (!group)
                return json(res, 404, { error: "no such room" });
            const active = [...groupTurnContexts.entries()].filter(([, context]) => context.groupId === group.id);
            await Promise.all(active.map(async ([providerThreadId, context]) => {
                cancelledGroupTurns.add(providerThreadId);
                pendingCloudLeaseByThread.get(providerThreadId)?.abort();
                pendingCloudLeaseByThread.delete(providerThreadId);
                await registry.get(context.instanceId ?? "")?.adapter.interruptTurn(providerThreadId).catch(() => { });
                releaseCloudLease(providerThreadId);
            }));
            return json(res, 200, { ok: true, cancelled: active.length });
        }
        // emoji reactions — works on any thread (1:1 or room)
        m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/reactions$/);
        if (m && method === "POST") {
            const body = await readBody(req);
            const emoji = String(body.emoji ?? "").slice(0, 8);
            if (!emoji)
                return json(res, 400, { error: "emoji required" });
            const patched = store.toggleReaction(m[1], m[2], emoji, typeof body.by === "string" ? body.by : "user");
            if (!patched)
                return json(res, 404, { error: "no such message" });
            broadcast({ kind: "message.patch", threadId: m[1], message: patched });
            return json(res, 200, { message: patched });
        }
        if (method === "POST" && path === "/api/bots") {
            const bot = store.createBot();
            store.patchBot(bot.id, { modelSelection: await defaultSelection() });
            return json(res, 201, { bot: wireBotWithThread(store.bot(bot.id)) });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const body = await readBody(req);
            const patch = {};
            for (const key of ["name", "title", "description", "notifications", "modelSelection", "unread", "computer", "color", "mascotShape", "avatarKind", "modelAvatar", "customMascotShape", "avatarImage", "mascotExpression", "pinned", "hidden", "routingMode", "maxFailovers"]) {
                if (body[key] !== undefined)
                    patch[key] = body[key];
            }
            if (body.routingMode !== undefined && !["manual", "balanced", "quality", "speed", "cost"].includes(body.routingMode)) {
                return json(res, 400, { error: "invalid routingMode" });
            }
            if (body.maxFailovers !== undefined && (!Number.isInteger(body.maxFailovers) || body.maxFailovers < 0 || body.maxFailovers > 4)) {
                return json(res, 400, { error: "maxFailovers must be an integer from 0 to 4" });
            }
            if (body.avatarImage !== undefined) {
                if (body.avatarImage !== null) {
                    if (typeof body.avatarImage !== "string" || !/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(body.avatarImage)) {
                        return json(res, 400, { error: "avatarImage must be a PNG, JPEG, or WebP data URL" });
                    }
                    const encoded = body.avatarImage.slice(body.avatarImage.indexOf(",") + 1);
                    const bytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
                    if (bytes > 512 * 1024)
                        return json(res, 413, { error: "avatarImage is too large (max 512 KiB)" });
                }
                patch.avatarImage = body.avatarImage;
            }
            if (body.chiefOfStaff !== undefined && typeof body.chiefOfStaff !== "boolean") {
                return json(res, 400, { error: "chiefOfStaff must be true or false" });
            }
            const existing = store.bot(m[1]);
            if (body.hidden === true && existing?.chiefOfStaff && body.chiefOfStaff !== false) {
                return json(res, 400, { error: "choose another Chief of Staff before hiding this bot" });
            }
            // the two permission fields decide what runs unattended, so they are
            // type-checked rather than copied through: a string alwaysAllow would
            // still answer .includes() — with substring matches, not tool names
            if (body.autoApprove !== undefined) {
                if (typeof body.autoApprove !== "boolean")
                    return json(res, 400, { error: "autoApprove must be true or false" });
                patch.autoApprove = body.autoApprove;
            }
            if (body.alwaysAllow !== undefined) {
                if (!Array.isArray(body.alwaysAllow) || body.alwaysAllow.some((t) => typeof t !== "string")) {
                    return json(res, 400, { error: "alwaysAllow must be a list of tool keys" });
                }
                patch.alwaysAllow = [...new Set(body.alwaysAllow)].slice(0, 200);
            }
            if (body.voiceProfile !== undefined) {
                if (body.voiceProfile === null) {
                    patch.voiceProfile = null;
                }
                else if (typeof body.voiceProfile === "object") {
                    const value = body.voiceProfile;
                    const voice = typeof value.voice === "string" ? value.voice.trim().slice(0, 240) : "";
                    if (!voice)
                        return json(res, 400, { error: "voiceProfile.voice is required" });
                    if (typeof value.speed !== "number" || !Number.isFinite(value.speed)) {
                        return json(res, 400, { error: "voiceProfile.speed must be a number" });
                    }
                    if (value.gain !== undefined && (typeof value.gain !== "number" || !Number.isFinite(value.gain))) {
                        return json(res, 400, { error: "voiceProfile.gain must be a number" });
                    }
                    patch.voiceProfile = {
                        voice,
                        speed: Math.min(4, Math.max(0.25, value.speed)),
                        ...(value.gain === undefined ? {} : { gain: Math.min(10, Math.max(-10, value.gain)) }),
                    };
                }
                else {
                    return json(res, 400, { error: "voiceProfile must be an object or null" });
                }
            }
            const bot = store.patchBot(m[1], patch);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const chiefChanges = body.chiefOfStaff === true
                ? store.setChiefOfStaff(bot.id)
                : body.chiefOfStaff === false && bot.chiefOfStaff
                    ? store.setChiefOfStaff(null)
                    : [];
            if (chiefChanges === null)
                return json(res, 404, { error: "no such bot" });
            const changed = new Map([[bot.id, store.bot(bot.id)]]);
            for (const changedBot of chiefChanges)
                changed.set(changedBot.id, changedBot);
            for (const changedBot of changed.values())
                broadcastBot(changedBot);
            return json(res, 200, { bot: wireBot(store.bot(bot.id)) });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)$/);
        if (m && method === "DELETE") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            // a running turn dies with its bot
            pendingCloudLeaseByThread.get(bot.threadId)?.abort();
            pendingCloudLeaseByThread.delete(bot.threadId);
            await providerForThread(bot.threadId, bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => { });
            releaseCloudLease(bot.threadId);
            stopScreenPoller(bot.id);
            releaseComputerControl(bot.id);
            botBoxIds.delete(bot.id);
            store.deleteBot(bot.id);
            for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
                try {
                    unlinkSync(join(dir, `${bot.threadId}.ndjson`));
                }
                catch { }
            }
            broadcast({ kind: "bot.deleted", botId: bot.id });
            return json(res, 200, { ok: true });
        }
        // onboarding/ask cards persist their answered/dismissed state
        m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
        if (m && method === "PATCH") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m[2]);
            if (!existing?.card)
                return json(res, 404, { error: "no such card" });
            const body = await readBody(req);
            const patched = store.patchMessage(bot.threadId, m[2], {
                card: {
                    ...existing.card,
                    ...(body.answered !== undefined ? { answered: body.answered } : {}),
                    ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
                },
            });
            broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
            return json(res, 200, { message: patched });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
        if (m && method === "POST") {
            const body = await readBody(req);
            const text = String(body.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "text required" });
            const reasoningLevel = parseReasoningRequest(body.reasoningLevel, body.reasoningEffort);
            const bot = store.bot(m[1]);
            const queued = await startTurn(m[1], text, { reasoningLevel, replyTo: bot ? replyReferenceForThread(bot.threadId, body.replyTo) : undefined });
            return json(res, 202, { ok: true, ...queued });
        }
        // edit a user message → fork the conversation there and rerun the turn.
        // Rewinding a live thread is refused, exactly like switching versions
        // below: interrupting mid-flight and branching under the dying turn is
        // how a conversation ends up with two tails. Stop, then edit.
        m = path.match(/^\/api\/bots\/([\w-]+)\/messages\/([\w-]+)\/edit$/);
        if (m && method === "POST") {
            const messageId = m[2];
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            const text = String(body.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "text required" });
            // everything from here down is synchronous, so two racing edits can
            // never both get past this check: startTurn flips busy before the
            // next request is handled
            if (bot.busy)
                return json(res, 409, { error: "the bot is working — stop it before editing" });
            const source = store.messagesFor(bot.threadId).find((msg) => msg.id === messageId);
            if (!source || source.role !== "user" || source.kind !== "text") {
                return json(res, 404, { error: "only user messages can be edited" });
            }
            if ((bot.routingMode ?? "manual") === "manual" && !registry.get(bot.modelSelection.instanceId)) {
                return json(res, 409, {
                    error: `provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`,
                });
            }
            const message = store.branchMessage(bot.threadId, messageId, text);
            if (!message)
                return json(res, 404, { error: "no such message" });
            store.patchBot(bot.id, { rewound: true });
            broadcast({ kind: "message", threadId: bot.threadId, message });
            broadcast({ kind: "thread", threadId: bot.threadId, activeLeafId: message.id });
            const queued = await startTurn(bot.id, text, { userMessage: message });
            return json(res, 202, { ok: true, ...queued });
        }
        // switch which fork of the conversation is visible (no new turn)
        m = path.match(/^\/api\/bots\/([\w-]+)\/active-branch$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            if (bot.busy)
                return json(res, 409, { error: "the bot is working — stop it before switching versions" });
            const body = await readBody(req);
            const leaf = store.setActiveLeaf(bot.threadId, String(body.messageId ?? ""));
            if (!leaf)
                return json(res, 404, { error: "no such message" });
            // provider sessions still hold the other branch — next turn replays
            store.patchBot(bot.id, { rewound: true });
            broadcast({ kind: "thread", threadId: bot.threadId, activeLeafId: leaf });
            return json(res, 200, { activeLeafId: leaf });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            const pending = providerRequestById.get(String(body.requestId));
            if (pending && pending.logicalThreadId !== bot.threadId)
                return json(res, 404, { error: "no such pending request" });
            const providerThreadId = pending?.providerThreadId ?? bot.threadId;
            const instance = pending ? registry.get(pending.instanceId) : providerForThread(bot.threadId, bot.modelSelection.instanceId);
            if (!instance)
                return json(res, 409, { error: "provider unavailable" });
            await instance.adapter.respondToRequest(providerThreadId, String(body.requestId), {
                behavior: body.behavior,
                message: body.message,
            });
            return json(res, 200, { ok: true });
        }
        // Answer by THREAD, so a request raised inside a room can be answered
        // too: a member's turn runs on the room's thread, and the bot that
        // owns the pending request is the one currently speaking there.
        m = path.match(/^\/api\/threads\/([\w-]+)\/respond$/);
        if (m && method === "POST") {
            const threadId = m[1];
            const body = await readBody(req);
            const pending = providerRequestById.get(String(body.requestId));
            if (pending) {
                if (pending.logicalThreadId !== threadId)
                    return json(res, 404, { error: "no such pending request" });
                const instance = registry.get(pending.instanceId);
                if (!instance)
                    return json(res, 409, { error: "provider unavailable" });
                await instance.adapter.respondToRequest(pending.providerThreadId, String(body.requestId), {
                    behavior: body.behavior,
                    message: body.message,
                });
                return json(res, 200, { ok: true });
            }
            const group = store.groupByThread(threadId);
            const owner = group ? (group.busyBotId ? store.bot(group.busyBotId) : undefined) : store.botByThread(threadId);
            if (!owner)
                return json(res, 404, { error: "nothing is waiting on an answer in this conversation" });
            const instance = providerForThread(threadId, owner.modelSelection.instanceId);
            if (!instance)
                return json(res, 409, { error: "provider unavailable" });
            await instance.adapter.respondToRequest(threadId, String(body.requestId), {
                behavior: body.behavior,
                message: body.message,
            });
            return json(res, 200, { ok: true });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const cancelled = turnScheduler.cancelQueued(bot.id);
            for (const item of cancelled) {
                const traceId = item.value.options?.traceId;
                if (traceId) {
                    taskTraces.finish(traceId, "cancelled", "cancelled");
                    broadcastTrace(traceId);
                }
            }
            const active = activeRoutedTurns.get(bot.threadId);
            if (active)
                active.cancelled = true;
            const instance = providerForThread(bot.threadId, bot.modelSelection.instanceId);
            pendingCloudLeaseByThread.get(bot.threadId)?.abort();
            pendingCloudLeaseByThread.delete(bot.threadId);
            try {
                await instance?.adapter.interruptTurn(bot.threadId);
            }
            finally {
                releaseCloudLease(bot.threadId);
            }
            if (!turnScheduler.isActive(bot.id)) {
                store.patchBot(bot.id, { busy: false });
                broadcastBot(store.bot(bot.id));
            }
            return json(res, 200, { ok: true, cancelled: cancelled.length });
        }
        // ── tasks: a bot's separate contexts ────────────────────────────────
        // The bot record answers with its messages because switching tasks
        // changes which transcript is live, and a partial patch would leave
        // the client showing the previous task's conversation.
        m = path.match(/^\/api\/bots\/([\w-]+)\/tasks$/);
        if (m && method === "POST") {
            const bot = store.bot(m[1]);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            if (bot.busy)
                return json(res, 409, { error: "this bot is working — let it finish before starting a task" });
            const body = await readBody(req);
            const task = store.createTask(bot.id, typeof body.title === "string" ? body.title : undefined);
            if (!task)
                return json(res, 500, { error: "couldn't create that task" });
            const fresh = wireBotWithThread(store.bot(bot.id));
            broadcastBot(store.bot(bot.id), true);
            return json(res, 201, { bot: fresh, task: wireTask(task) });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/);
        if (m && method === "POST") {
            const switched = store.switchTask(m[1], m[2]);
            if (!switched)
                return json(res, 404, { error: "no such task" });
            const fresh = wireBotWithThread(switched);
            broadcastBot(switched, true);
            return json(res, 200, { bot: fresh });
        }
        if (m && method === "PATCH") {
            const body = await readBody(req);
            const task = store.renameTask(m[1], m[2], String(body.title ?? ""));
            if (!task)
                return json(res, 404, { error: "no such task" });
            broadcastBot(store.bot(m[1]), true);
            return json(res, 200, { task: wireTask(task) });
        }
        if (m && method === "DELETE") {
            const bot = store.bot(m[1]);
            if (bot?.busy && bot.threadId === m[2]) {
                return json(res, 409, { error: "this task is running — stop it first" });
            }
            const updated = store.deleteTask(m[1], m[2]);
            if (!updated)
                return json(res, 400, { error: "a bot keeps at least one task" });
            const fresh = wireBotWithThread(updated);
            broadcastBot(updated, true);
            return json(res, 200, { bot: fresh });
        }
        // identity handshake for the packaged app's port fallback: the forked
        // child proves it is OURS by echoing its pid (a stray dev server has
        // the same API shape but a different pid)
        if (method === "GET" && path === "/api/health") {
            return json(res, 200, { app: "openmausbot", pid: process.pid, static: Boolean(STATIC_DIR) });
        }
        // ── provider instances (model picker) ──
        if (method === "GET" && path === "/api/instances") {
            resetPathCache();
            return json(res, 200, { instances: await registry.describe(providerHealth) });
        }
        // ── app config (API keys — never echoed back, booleans only) ──
        if (method === "GET" && path === "/api/config") {
            return json(res, 200, configStatus());
        }
        if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
            const body = await readBody(req);
            const patch = {};
            for (const key of ["xai", "gemini", "anthropic", "openai", "domestic", "composio", "box", "profile", "voice"]) {
                if (body[key] && typeof body[key] === "object")
                    patch[key] = body[key];
            }
            if (!Object.keys(patch).length)
                return json(res, 400, { error: "nothing to save" });
            // check a box token against the provider before storing it: a
            // rejected token used to save happily and only surface as a 401 in
            // another panel later, with nothing the user could act on
            const newBoxToken = patch.box?.token;
            if (typeof newBoxToken === "string" && newBoxToken.trim()) {
                const check = await box.verifyToken(newBoxToken.trim());
                if (!check.ok)
                    return json(res, 400, { error: check.message });
            }
            saveConfig(patch);
            Object.assign(cfg, loadConfig());
            // provider keys change the fleet; a profile edit must not kill
            // in-flight turns with a pointless reload
            if (Object.keys(patch).some((k) => !["profile", "voice"].includes(k)))
                await reloadProviders();
            const status = configStatus();
            broadcast({ kind: "config", ...status });
            return json(res, 200, status);
        }
        // ── cross-platform voice I/O ─────────────────────────────────────
        if (method === "POST" && path === "/api/voice/transcribe") {
            const audio = await readBytes(req);
            const mime = String(req.headers["x-audio-mime"] ?? req.headers["content-type"] ?? "audio/webm")
                .split(";", 1)[0]
                .trim();
            return json(res, 200, { text: await transcribe(cfg, audio, mime) });
        }
        if (method === "POST" && path === "/api/voice/prepare") {
            const body = await readBody(req);
            const text = String(body.text ?? "");
            return json(res, 200, { utterances: toUtterances(text) });
        }
        if (method === "POST" && path === "/api/voice/speak") {
            const body = await readBody(req);
            const botId = typeof body.botId === "string" ? body.botId : "";
            const bot = botId ? store.bot(botId) : null;
            if (botId && !bot)
                return json(res, 404, { error: "no such bot" });
            const inline = body.tuning && typeof body.tuning === "object"
                ? body.tuning
                : {};
            const audio = await synthesize(cfg, String(body.text ?? ""), {
                ...(bot?.voiceProfile ?? {}),
                ...inline,
            });
            res.writeHead(200, {
                "content-type": audio.mime,
                "content-length": String(audio.bytes.byteLength),
                "cache-control": "no-store",
            });
            return res.end(audio.bytes);
        }
        // ── discover relay models ──
        m = path.match(/^\/api\/relay\/(anthropic|openai|gemini|xai|deepseek|zhipu|dashscope|moonshot)\/discover-models$/);
        if (m && method === "POST") {
            const section = m[1];
            try {
                const ids = await discoverModels(cfg, section);
                const { instanceId } = saveDiscoveredModels(section, ids);
                Object.assign(cfg, loadConfig());
                await reloadProviders();
                broadcast({ kind: "config", ...configStatus() });
                return json(res, 200, { ok: true, instanceId, count: ids.length });
            }
            catch (e) {
                return json(res, 400, { ok: false, error: e?.message ?? String(e) });
            }
        }
        // ── connectors (Composio) ──
        if (method === "GET" && path === "/api/connectors/catalog") {
            const { cards, source, diagnostic } = await composio.listToolkits(cfg);
            return json(res, 200, { configured: Boolean(cfg.composio?.key), source, diagnostic, cards });
        }
        if (method === "GET" && path === "/api/connectors") {
            const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
            if (!cfg.composio?.key)
                return json(res, 200, { configured: false, services: {} });
            const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
            return json(res, 200, { configured: true, services: status });
        }
        m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
        if (m && method === "POST")
            return json(res, 200, await composio.authorizeService(cfg, m[1]));
        m = path.match(/^\/api\/connectors\/([\w-]+)$/);
        if (m && method === "DELETE")
            return json(res, 200, await composio.removeService(cfg, m[1]));
        // ── user-managed remote MCP services ──────────────────────────────
        if (method === "GET" && path === "/api/mcp/servers") {
            return json(res, 200, { servers: mcp.publicMcpServers(cfg) });
        }
        if (method === "GET" && path === "/api/mcp/audit") {
            return json(res, 200, { entries: recentMcpAudit(Number(url.searchParams.get("limit") ?? 50)) });
        }
        if (method === "GET" && path === "/api/mcp/config/export") {
            return json(res, 200, mcp.exportMcpConfig(cfg, new Map(store.bots.map((bot) => [bot.id, bot.name]))));
        }
        if (method === "POST" && path === "/api/mcp/config/import") {
            try {
                const next = mcp.importMcpConfig(cfg, await readBody(req), new Map(store.bots.map((bot) => [bot.name, bot.id])));
                replaceMcpServers(next.servers);
                Object.assign(cfg, loadConfig());
                return json(res, 200, { imported: next.imported, servers: mcp.publicMcpServers(cfg) });
            }
            catch (error) {
                return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        if (method === "POST" && path === "/api/mcp/servers") {
            try {
                const next = mcp.upsertMcpServer(cfg, await readBody(req));
                replaceMcpServers(next.servers);
                Object.assign(cfg, loadConfig());
                return json(res, 201, { server: mcp.publicMcpServers(cfg).find((server) => server.id === next.id) });
            }
            catch (error) {
                return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        m = path.match(/^\/api\/mcp\/servers\/([a-z][\w-]{0,31})$/);
        if (m && method === "PATCH") {
            try {
                const next = mcp.upsertMcpServer(cfg, { ...(await readBody(req)), id: m[1] });
                replaceMcpServers(next.servers);
                Object.assign(cfg, loadConfig());
                return json(res, 200, { server: mcp.publicMcpServers(cfg).find((server) => server.id === next.id) });
            }
            catch (error) {
                return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        if (m && method === "DELETE") {
            const servers = mcp.deleteMcpServer(cfg, m[1]);
            if (!servers)
                return json(res, 404, { error: "no such MCP server" });
            replaceMcpServers(servers);
            Object.assign(cfg, loadConfig());
            return json(res, 200, { ok: true });
        }
        m = path.match(/^\/api\/mcp\/servers\/([a-z][\w-]{0,31})\/test$/);
        if (m && method === "POST") {
            const id = m[1];
            const server = cfg.mcp?.servers?.[id];
            if (!server)
                return json(res, 404, { error: "no such MCP server" });
            try {
                const tools = await mcp.probeMcpServer(server);
                const servers = mcp.recordMcpProbe(cfg, id, { status: "ok", tools });
                if (servers) {
                    replaceMcpServers(servers);
                    Object.assign(cfg, loadConfig());
                }
                return json(res, 200, {
                    ok: true,
                    tools,
                    server: mcp.publicMcpServers(cfg).find((candidate) => candidate.id === id),
                });
            }
            catch (error) {
                const safeError = mcp.safeMcpError(error);
                const servers = mcp.recordMcpProbe(cfg, id, { status: "error", error: safeError });
                if (servers) {
                    replaceMcpServers(servers);
                    Object.assign(cfg, loadConfig());
                }
                return json(res, 400, { ok: false, error: safeError });
            }
        }
        // ── the bot's cloud computer (Box) ──
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/control$/);
        if (m && (method === "GET" || method === "POST")) {
            const botId = m[1];
            if (!store.bot(botId))
                return json(res, 404, { error: "no such bot" });
            if (method === "GET")
                return json(res, 200, effectiveComputerControl(botId));
            const body = await readBody(req);
            const action = String(body.action ?? "");
            let snapshot;
            if (action === "take") {
                const knownBoxId = botBoxIds.get(botId) ?? (await box.findBox(cfg, botId).catch(() => null))?.id;
                if (knownBoxId)
                    botBoxIds.set(botId, knownBoxId);
                if (knownBoxId) {
                    const lease = cloudComputerLeases.status(knownBoxId);
                    if (lease.owner?.botId && lease.owner.botId !== botId) {
                        return json(res, 409, {
                            error: "这台共享云电脑正在由其他 Bot 使用，请从当前占用者面板接管",
                            botId: lease.owner.botId,
                        });
                    }
                    const conflict = [...botBoxIds.entries()].find(([otherBotId, otherBoxId]) => otherBoxId === knownBoxId && otherBotId !== botId && computerControl.snapshot(otherBotId).held);
                    if (conflict)
                        return json(res, 409, { error: "这台共享云电脑已被其他用户接管", botId: conflict[0] });
                }
                snapshot = computerControl.take(botId);
            }
            else if (action === "release")
                snapshot = releaseComputerControl(botId);
            else if (action === "dismiss-help")
                snapshot = computerControl.dismissHelp(botId);
            else
                return json(res, 400, { error: "action must be take, release, or dismiss-help" });
            broadcastComputerControl(botId);
            return json(res, 200, snapshot);
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
        if (m && method === "GET") {
            const status = await box.boxStatus(cfg, m[1]);
            const boxId = status.box?.boxId;
            if (typeof boxId === "string")
                botBoxIds.set(m[1], boxId);
            const lease = typeof boxId === "string" ? cloudComputerLeases.status(boxId) : null;
            return json(res, 200, { ...status, lease, control: effectiveComputerControl(m[1]) });
        }
        m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|replace|join|sleep|exec|screenshot)$/);
        if (m && method === "POST") {
            const botId = m[1];
            const bot = store.bot(botId);
            if (!bot)
                return json(res, 404, { error: "no such bot" });
            const body = await readBody(req);
            const refusal = computerControlRefusal(effectiveComputerControl(botId));
            if (m[2] === "exec" && refusal) {
                return json(res, 409, { error: refusal });
            }
            switch (m[2]) {
                case "provision":
                    return json(res, 200, await box.provisionBox(cfg, botId, bot.name, (state) => broadcast({ kind: "computer", botId, state })));
                case "replace": {
                    return json(res, 200, await box.replaceAllBoxes(cfg, bot.name, String(body.confirm ?? ""), (state) => broadcast({ kind: "computer", botId, state })));
                }
                case "join":
                    return json(res, 200, await box.joinBox(cfg, botId));
                case "sleep":
                    releaseComputerControl(botId);
                    return json(res, 200, await box.sleepBox(cfg, botId, body?.force === true));
                case "exec": {
                    return json(res, 200, await box.execOnBox(cfg, botId, String(body.command ?? "")));
                }
                case "screenshot":
                    return json(res, 200, await box.screenshotBox(cfg, botId));
            }
        }
        // packaged app: the server serves the built UI too (window → :8799 for
        // everything, no dev proxy to die). OMB_STATIC_DIR is set by Electron.
        if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
            const safe = path === "/" ? "/index.html" : path.replace(/\.\./g, "");
            const file = join(STATIC_DIR, safe);
            try {
                const data = readFileSync(file);
                res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
                return res.end(data);
            }
            catch {
                // SPA fallback
                try {
                    const data = readFileSync(join(STATIC_DIR, "index.html"));
                    res.writeHead(200, { "content-type": "text/html" });
                    return res.end(data);
                }
                catch {
                    /* fall through to 404 */
                }
            }
        }
        return json(res, 404, { error: `no route: ${method} ${path}` });
    }
    catch (e) {
        const status = e?.status ?? 500;
        return json(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
});
server.listen(PORT, "127.0.0.1", () => {
    console.log(`openmausbot server on http://127.0.0.1:${PORT}`);
});
const routineTimer = setInterval(scheduleDueRoutines, 15_000);
routineTimer.unref?.();
let shutdownPromise = null;
function shutdown() {
    if (shutdownPromise)
        return shutdownPromise;
    shutdownPromise = (async () => {
        clearInterval(routineTimer);
        for (const controller of pendingCloudLeaseByThread.values())
            controller.abort();
        pendingCloudLeaseByThread.clear();
        for (const release of cloudLeaseByThread.values())
            release();
        cloudLeaseByThread.clear();
        cloudLeaseBoxByThread.clear();
        await registry.disposeAll();
        for (const client of sseClients) {
            try {
                client.res.end();
            }
            catch { }
        }
        sseClients.clear();
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                server.closeAllConnections?.();
                finish();
            }, 3_000);
            timer.unref?.();
            server.close(finish);
        });
    })();
    return shutdownPromise;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        void shutdown().finally(() => process.exit(0));
    });
}
