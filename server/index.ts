// XinyunOpen Bot server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import "./load-env.ts";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { approvalKey, autoDecision } from "./auto-approve.ts";
import * as box from "./box.ts";
import { cloudComputerLeases } from "./cloud-computer-pool.ts";
import * as composio from "./composio.ts";
import * as mcp from "./mcp.ts";
import { appendMcpAudit, recentMcpAudit } from "./mcp-audit.ts";
import { chiefOfStaffSystemPrompt } from "./chief-of-staff.ts";
import { ensureDirs, instanceConfigs, loadConfig, replaceMcpServers, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.ts";
import { resetPathCache } from "./env-path.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { discoverModels, saveDiscoveredModels, type RelaySection } from "./models-discover.ts";
import { modelForReasoningLevel } from "./model-downgrade.ts";
import { parseReasoningRequest, reasoningEffortForLevel, type ReasoningLevel } from "./reasoning.ts";
import { shouldUseCloudComputer } from "./turn-computer.ts";
import { buildTurnContext, engineIsFresh } from "./turn-context.ts";
import { SseReplayBuffer } from "./sse-replay.ts";
import { ComputerControl } from "./computer-control.ts";
import { extensionForMime, IMAGE_MAX_BYTES, readAttachment, saveImage, type SavedAttachment } from "./attachments.ts";
import { TurnScheduler } from "./turn-scheduler.ts";

import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { EventBus } from "./harness/bus.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { DOMESTIC_PROVIDER_IDS } from "./domestic-models.ts";
import {
  mentionedBots,
  roomResponders,
  Store,
  type GroupDefaultResponder,
  type Message,
  type TaskRecord,
} from "./store.ts";
import { newId } from "./contracts.ts";
import { describeVoice, synthesize, transcribe } from "./voice/index.ts";
import { toUtterances } from "./voice/speech-text.ts";

const PORT = Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799);
const STATIC_DIR = process.env.OMB_STATIC_DIR || null;
const MIME: Record<string, string> = {
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
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));

const bus = new EventBus();
bus.attach(registry.instances());

// ── peer-agent comms wiring ────────────────────────────────────────────
// A shared secret guards the localhost-only /api/internal endpoints the
// agents-proxy calls; regenerated each boot (the proxy gets it via env).
const COMMS_TOKEN = randomBytes(24).toString("hex");
const computerControl = new ComputerControl();
// Cap message chains: depth 0 = a user-initiated turn (may ask a peer);
// a peer invoked via ask_bot runs at depth 1 and gets NO agents tool, so
// A→B is allowed but B→C (and A→B→A loops) never start.
const MAX_COMMS_DEPTH = 1;
const turnScheduler = new TurnScheduler<{
  text: string;
  options?: { commsDepth?: number; userMessage?: Message; reasoningLevel?: ReasoningLevel };
}>();
type HandoffStatus = "queued" | "running" | "completed" | "failed";
type HandoffRecord = {
  id: string;
  fromBotId: string;
  toBotId: string;
  status: HandoffStatus;
  createdAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};
const handoffs = new Map<string, HandoffRecord>();
// proxy entry: .ts in dev (node type-strips), .js in the packaged dist-server
const agentsProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
// in the packaged app process.execPath is Electron — run the proxy as node
const AGENTS_NODE_FLAG = { ELECTRON_RUN_AS_NODE: "1" };

function agentsIntegration(botId: string, depth: number) {
  return {
    command: process.execPath,
    args: [agentsProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      OMB_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      OMB_BOT_ID: botId,
      OMB_COMMS_TOKEN: COMMS_TOKEN,
      OMB_TURN_DEPTH: String(depth),
    },
  };
}

/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
function askBotAndWait(targetBotId: string, message: string, depth: number): Promise<string> {
  const target = store.bot(targetBotId);
  if (!target) return Promise.resolve("(no such bot)");
  const threadId = target.threadId;
  return new Promise((resolve) => {
    let text = "";
    let started = false;
    let done = false;
    const finish = (out: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(out);
    };
    const unsub = bus.subscribe((e: RuntimeEvent) => {
      if (e.threadId !== threadId) return;
      if (e.type === "turn.started") {
        started = true;
      } else if (e.type === "item.completed" && e.itemType === "assistant_text" && started) {
        text += (text ? "\n" : "") + e.text;
      } else if (e.type === "turn.completed" && started) {
        finish(text || "(the bot finished without a text reply)");
      }
    });
    const timer = setTimeout(() => finish(text || "(timed out waiting for the bot to reply)"), 4 * 60_000);
    startTurn(targetBotId, message, { commsDepth: depth + 1 }).catch((err) =>
      finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`),
    );
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

type StoredBot = NonNullable<ReturnType<typeof store.bot>>;

/** Provider-native continuation tokens never cross the server boundary. */
const wireTask = ({ resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, ...task }: TaskRecord) => task;

/** Strip both the legacy active-task cursor mirror and all per-task cursors. */
const wireBot = (bot: StoredBot) => {
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

const wireBotWithThread = (bot: StoredBot) => ({
  ...wireBot(bot),
  messages: store.messagesFor(bot.threadId),
  activeLeafId: store.activeLeaf(bot.threadId),
  tasks: store.tasks(bot.id).map(wireTask),
});

// ── SSE fan-out to clients ─────────────────────────────────────────────
interface SseClient {
  res: ServerResponse;
  screens: boolean;
}

const sseClients = new Set<SseClient>();
const sseReplay = new SseReplayBuffer();
const wantsSseKind = (client: SseClient, kind: string) => kind !== "screen" || client.screens;

function broadcast(payload: Record<string, unknown>) {
  const { kind, frame } = sseReplay.append(payload);
  for (const client of [...sseClients]) {
    if (!wantsSseKind(client, kind)) continue;
    try {
      client.res.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastBot(bot: StoredBot | null | undefined, withThread = false) {
  if (bot) broadcast({ kind: "bot", bot: withThread ? wireBotWithThread(bot) : wireBot(bot) });
}

function broadcastComputerControl(botId: string) {
  broadcast({ kind: "computer-control", botId, control: computerControl.snapshot(botId) });
}

// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map<string, string>(); // itemId -> messageId
const mcpAuditByItem = new Map<string, {
  botId: string | null;
  threadId: string;
  serverId: string;
  tool: string;
  startedAt: string;
}>();
const askMessageByRequest = new Map<string, string>(); // requestId -> messageId
const cloudLeaseByThread = new Map<string, () => void>();
const pendingCloudLeaseByThread = new Map<string, AbortController>();
// Providers may publish running totals more than once during a turn. Keep
// only the latest snapshot and fold it once when the turn settles.
const turnUsage = new Map<string, { input: number; output: number }>();

// Group threads: the fold needs to know WHO is talking — the turn engine
// records the active member here before dispatching its turn.
const groupSpeakers = new Map<string, { botId: string; name: string; color: string }>();


bus.subscribe((event: RuntimeEvent) => {
  broadcast({ kind: "runtime", event });
  const bot = store.botByThread(event.threadId);
  const group = bot ? undefined : store.groupByThread(event.threadId);
  if (!bot && !group) return;
  const speaker = group ? groupSpeakers.get(event.threadId) : undefined;

  const pushMessage = (m: Omit<Message, "id" | "at">) => {
    const message = store.appendMessage(event.threadId, group && m.role === "bot" ? { ...m, from: speaker } : m);
    broadcast({ kind: "message", threadId: event.threadId, message });
    return message;
  };

  switch (event.type) {
    case "session.started":
      if (bot && event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId, event.threadId);
      }
      break;
    case "item.completed":
      if (event.itemType === "assistant_text") {
        pushMessage({ role: "bot", kind: "text", text: event.text });
      } else if (event.itemType === "tool" && event.itemId) {
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
          toolName = store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool";
          const patched = store.patchMessage(event.threadId, messageId, {
            tool: { name: toolName, ok: event.ok },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
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
        if (event.title?.endsWith("__ask_bot")) break;
        const message = pushMessage({ role: "bot", kind: "activity", tool: { name: event.title ?? "tool" } });
        if (event.itemId) toolMessageByItem.set(event.itemId, message.id);
      }
      break;
    case "request.opened": {
      const permission = event.requestType === "permission";
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
        const instance = registry.get(asker.modelSelection.instanceId);
        const requestId = event.requestId;
        const { tool, summary } = event;
        // The chip is written only AFTER the provider takes the answer.
        // Claiming approval first and correcting later means a moment
        // where the transcript says "approved" over a request nothing
        // answered — and if the provider is gone entirely, forever.
        void (async () => {
          try {
            if (!instance) throw new Error("provider unavailable");
            await instance.adapter.respondToRequest(event.threadId, requestId, { behavior: "allow" });
            pushMessage({
              role: "bot",
              kind: "activity",
              tool: { name: `${settled}: ${summary.slice(0, 120)}`, ok: true },
            });
          } catch {
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
      if (event.requestId) askMessageByRequest.set(event.requestId, message.id);
      break;
    }
    case "request.resolved": {
      const messageId = event.requestId ? askMessageByRequest.get(event.requestId) : null;
      if (messageId) {
        const existing = store.messagesFor(event.threadId).find((m) => m.id === messageId);
        if (existing?.card && !existing.card.answered) {
          const patched = store.patchMessage(event.threadId, messageId, {
            card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
        }
        if (event.requestId) askMessageByRequest.delete(event.requestId);
      }
      break;
    }
    case "runtime.error":
      pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
      break;
    case "thread.token-usage.updated":
      turnUsage.set(event.threadId, { input: event.input, output: event.output });
      break;
    case "turn.completed": {
      const usage = turnUsage.get(event.threadId);
      turnUsage.delete(event.threadId);
      // Group turns share a room thread, so only 1:1 task turns currently
      // have an unambiguous task tally.
      if (bot && usage) store.addTaskUsage(bot.id, event.threadId, usage);
      const auditPrefix = `${event.threadId}:${event.turnId ?? ""}:`;
      for (const [key, audit] of mcpAuditByItem) {
        if (!key.startsWith(auditPrefix)) continue;
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
      if (bot) {
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
            cloudLeaseByThread.get(event.threadId)?.();
            cloudLeaseByThread.delete(event.threadId);
          });
        } else {
          cloudLeaseByThread.get(event.threadId)?.();
          cloudLeaseByThread.delete(event.threadId);
        }
        finishScheduledTurn(bot.id);
      }
      // group busy/unread settle in the group turn engine, which knows
      // whether more member turns are queued behind this one
      break;
    }
  }
});

// ── live screen: poll the bot's box while it works ────────────────────
// Frames stream to clients as SSE {kind:'screen'} (the "Bot's screen"
// panel); the final frame is folded into the transcript on turn end.
type Frame = { png: string; mime: string };
const screenPollers = new Map<
  string,
  { timer: ReturnType<typeof setInterval> | null; capture: () => Promise<void>; last: Frame | null }
>();

/** The preview shares the box's single command endpoint with the agent's
 * own actions, so every frame we take is latency stolen from the work the
 * user is waiting on. Hence: a slow interval, a floor between captures,
 * and never two in flight. */
const SCREEN_POLL_MS = 6000;
const SCREEN_MIN_GAP_MS = 3000;

function startScreenPoller(botId: string, boxId?: string) {
  if (screenPollers.has(botId) || !box.boxConfigured(cfg)) return;
  // One capture at a time, shared by the interval, the pokes, and the
  // turn-end grab: awaiting the in-flight promise (rather than dropping the
  // call) is what lets the final frame be the settled one. The min-gap keeps
  // a tool-heavy turn from spending the box's single command endpoint on
  // previews the user isn't waiting for.
  let current: Promise<void> | null = null;
  let lastAt = 0;
  const entry = {
    timer: null as ReturnType<typeof setInterval> | null,
    capture: (): Promise<void> => {
      if (!current && Date.now() - lastAt < SCREEN_MIN_GAP_MS) return Promise.resolve();
      current ??= (async () => {
        try {
          // boxId is resolved once per turn — re-resolving per frame cost a
          // full LIST of the account's boxes
          const { png, format } = await box.screenshotBox(cfg, botId, boxId);
          const frame = { png, mime: format === "jpeg" ? "image/jpeg" : "image/png" };
          entry.last = frame;
          broadcast({ kind: "screen", botId, ...frame });
        } catch {
          /* box asleep or mid-command — try again next tick */
        } finally {
          lastAt = Date.now();
          current = null;
        }
      })();
      return current;
    },
    last: null as Frame | null,
  };
  entry.timer = setInterval(() => void entry.capture(), SCREEN_POLL_MS);
  screenPollers.set(botId, entry);
}

/** Event-driven refresh: capture NOW (the bot just acted on its screen)
 * instead of waiting for the next interval tick. Rate-limited inside
 * capture() — a tool-heavy turn used to fire one full REST chain per
 * completed tool, competing with the agent for the same endpoint. */
function pokeScreenPoller(botId: string) {
  void screenPollers.get(botId)?.capture();
}

function stopScreenPoller(botId: string) {
  const entry = screenPollers.get(botId);
  if (!entry) return;
  if (entry.timer) clearInterval(entry.timer);
  screenPollers.delete(botId);
}

/** Turn end: stop polling, then take ONE last fresh frame (awaiting any
 * in-flight poke first) so the settled screenshot shows the screen's actual
 * end state, not the previous action's. */
async function finalScreenFrame(botId: string): Promise<Frame | null> {
  const entry = screenPollers.get(botId);
  if (!entry) return null;
  if (entry.timer) clearInterval(entry.timer);
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
function userDataRoot(): string {
  if (process.platform === "win32") return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

// Local computer-use contract written by Electron main on startup
// (Electron's userData dir: ~/Library/Application Support on macOS,
// %APPDATA% on Windows — <dir>/cua-connection.json). Read fresh each turn —
// Electron may restart or permissions may change.
function readCuaConnection(): { command: string; args: string[]; env: Record<string, string> } | null {
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
      if (!conn || conn.mode === "unavailable" || !conn.mcpCommand) continue;
      return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: conn.mcpEnv ?? {} };
    } catch {
      /* try the next location */
    }
  }
  return null;
}

// ── turn dispatch (upstream ProviderCommandReactor, miniature) ──────────
async function runTurnNow(
  botId: string,
  text: string,
  opts?: { commsDepth?: number; userMessage?: Message; reasoningLevel?: ReasoningLevel },
) {
  const bot = store.bot(botId);
  if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (!registry.get(bot.modelSelection.instanceId)) {
    throw Object.assign(
      new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }
  const threadId = bot.threadId;
  const task = store.taskByThread(bot.id, threadId);
  if (!task) throw Object.assign(new Error("no such task"), { status: 404 });
  const commsDepth = opts?.commsDepth ?? 0;
  // a task takes its name from the first thing you asked it to do
  if (text.trim()) store.titleTaskFromFirstMessage(bot.id, text);

  const instance = registry.get(bot.modelSelection.instanceId);
  if (!instance) {
    throw Object.assign(
      new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }
  const instanceId = instance.instanceId;
  const reasoningEffort = reasoningEffortForLevel(opts?.reasoningLevel);
  const turnModel = modelForReasoningLevel(instance.models, bot.modelSelection.model, opts?.reasoningLevel);

  // an edit hands us its already-branched user message; a plain send appends
  let userMessage = opts?.userMessage;
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
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text! }));

  // After a rewind (edit / branch switch) the provider's native session
  // still contains the abandoned branch: start a fresh session instead of
  // resuming, and for cursor-resuming drivers replay the surviving path
  // inline (transcript-replay drivers get it via transcript). The flag is
  // cleared only once the turn is actually dispatched — clearing it here
  // would cost the next attempt its history if this dispatch fails.
  const rewound = Boolean(bot.rewound);
  const fresh =
    !rewound &&
    engineIsFresh({
      instanceId,
      lastInstanceId: task.lastInstanceId,
      resumeCursors: task.resumeCursors,
      transcript,
    });
  const { turnText, resume } = buildTurnContext({
    text,
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
    try {
      const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};
      if (cfg.composio?.key) integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
      const managedMcp = mcp.activeMcpIntegrations(cfg, bot.id);
      if (managedMcp.length) integrations.mcp = managedMcp;
      const wants = bot.computer; // 'cloud' | 'local' | 'off' | undefined(auto)
      // Capability, not provider name, decides whether this exact engine can
      // work through a cloud computer. `native` runs the whole turn on Box;
      // `mcp` mounts the provider-neutral computer proxy.
      const computerMode = instance.adapter.capabilities.computerMode;
      if (wants === "cloud" && !computerMode) {
        throw new Error("当前模型仅支持对话/本地编程，不能操作云端电脑；请切换到标有“支持云端工作”的模型");
      }
      let previewBoxId: string | null = null;
      let cloudFailure: Error | null = null;
      if (shouldUseCloudComputer(wants, computerMode, commsDepth)) {
        if (!box.boxConfigured(cfg)) {
          if (wants === "cloud") throw new Error("尚未配置 Box 令牌，无法启动云端电脑");
        } else {
          try {
            broadcast({ kind: "computer", botId: bot.id, state: "checking" });
            let b = await box.findBox(cfg, bot.id).catch(() => null);
            if (!b) {
              if (!box.automaticBoxCreationEnabled(cfg)) {
                throw new Error("未找到云端电脑；本机已禁止自动创建，请在电脑面板中明确执行创建命令");
              }
              await box.provisionBox(cfg, bot.id, bot.name, (state) =>
                broadcast({ kind: "computer", botId: bot.id, state }),
              );
              b = await box.findBox(cfg, bot.id).catch(() => null);
            }
            if (!b) throw new Error("云端电脑创建后仍无法解析，请稍后重试");
            if (!["idle", "ready", "running"].includes(b.state)) {
              broadcast({ kind: "computer", botId: bot.id, state: "waking" });
              b = (await box.readyBox(cfg, bot.id).catch(() => null)) ?? b;
            }
            if (!["idle", "ready", "running"].includes(b.state)) {
              throw new Error(`云端电脑当前状态为 ${b.state ?? "unknown"}，未能进入可工作状态`);
            }
            previewBoxId = b.id;
            integrations.computer = {
              boxId: b.id,
              token: cfg.box!.token!,
              control: {
                botId: bot.id,
                url: `http://127.0.0.1:${PORT}/api/internal/computer-control/${encodeURIComponent(bot.id)}`,
                token: COMMS_TOKEN,
              },
            };
          } catch (error) {
            cloudFailure = error instanceof Error ? error : new Error(String(error));
            if (wants === "cloud") throw cloudFailure;
          }
        }
      }
      // local computer (this Mac) via the Electron-hosted cua-driver: the
      // Electron main process owns the daemon (TCC attribution) and writes
      // its spawn contract to cua-connection.json; the harness only reads it
      if (!integrations.computer && computerMode === "mcp" && wants !== "off" && wants !== "cloud") {
        const cua = readCuaConnection();
        if (cua) integrations.localComputer = cua;
      }
      if (cloudFailure && !integrations.localComputer) throw cloudFailure;
      // peer-agent comms: give a user-initiated turn the list_bots/ask_bot
      // tools. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
      // stop, so the user's tokens can't be burned by a bot-to-bot loop.
      // Only drivers that mount the tools get the integration (and, via the
      // integrations.agents gate below, the prompt hint) — a bot on a driver
      // without it must not be told about tools it cannot call. Any bot can
      // still be the TARGET of ask_bot regardless of its driver.
      if (
        commsDepth < MAX_COMMS_DEPTH &&
        instance.adapter.capabilities.agentsMcp === true &&
        store.bots.filter((b) => b.id !== bot.id && !b.hidden).length > 0
      ) {
        integrations.agents = agentsIntegration(bot.id, commsDepth);
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit delegation nudge — the agent still does the ask_bot call
      // itself, so the harness stays the single owner of turns/permissions
      const tagged = integrations.agents
        ? mentionedBots(
            text,
            store.bots.filter((b) => b.id !== bot.id),
          )
        : [];
      const coordinationPrompt = bot.chiefOfStaff
        ? chiefOfStaffSystemPrompt(bot.id, store.bots, Boolean(integrations.agents))
        : integrations.agents
          ? "你可以通过机器人协作工具与其他机器人配合：list_bots 查看可用机器人，ask_bot 向指定机器人发送任务并取得回复。"
          : "";

      if (integrations.computer) {
        const leaseAbort = new AbortController();
        pendingCloudLeaseByThread.set(threadId, leaseAbort);
        try {
          const release = await cloudComputerLeases.acquire(
            integrations.computer.boxId,
            () => broadcast({ kind: "computer", botId: bot.id, state: "waiting" }),
            leaseAbort.signal,
          );
          cloudLeaseByThread.set(threadId, release);
          broadcast({ kind: "computer", botId: bot.id, state: "ready" });
        } finally {
          pendingCloudLeaseByThread.delete(threadId);
        }
      }

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
        system:
          persona +
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
      if (rewound) store.patchBot(bot.id, { rewound: false, resumeCursors: {} });
      store.markTaskDispatched(bot.id, threadId, instanceId);
      if (previewBoxId) startScreenPoller(bot.id, previewBoxId);
    } catch (e) {
      cloudLeaseByThread.get(threadId)?.();
      cloudLeaseByThread.delete(threadId);
      const message = e instanceof Error ? e.message : String(e);
      const failure = store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
      });
      broadcast({ kind: "message", threadId, message: failure });
      store.patchBot(bot.id, { busy: false });
      broadcastBot(store.bot(bot.id));
      finishScheduledTurn(bot.id);
    }
  })();
}

function finishScheduledTurn(botId: string) {
  if (!turnScheduler.isActive(botId)) return;
  turnScheduler.complete(botId);
  if (turnScheduler.hasPending(botId)) {
    store.patchBot(botId, { busy: true });
    broadcastBot(store.bot(botId));
    void drainBotQueue(botId);
  } else {
    store.patchBot(botId, { busy: false });
    broadcastBot(store.bot(botId));
  }
}

async function drainBotQueue(botId: string) {
  const next = turnScheduler.begin(botId);
  if (!next) return;
  try {
    await runTurnNow(botId, next.value.text, next.value.options);
  } catch (error) {
    const bot = store.bot(botId);
    if (bot) {
      const message = store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 180), ok: false },
      });
      broadcast({ kind: "message", threadId: bot.threadId, message });
    }
    finishScheduledTurn(botId);
  }
}

async function startTurn(
  botId: string,
  text: string,
  opts?: { commsDepth?: number; userMessage?: Message; reasoningLevel?: ReasoningLevel },
): Promise<{ queued: boolean; queueDepth: number }> {
  const bot = store.bot(botId);
  if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (!registry.get(bot.modelSelection.instanceId)) {
    throw Object.assign(
      new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }
  if (!opts?.userMessage) {
    const message = store.appendMessage(bot.threadId, { role: "user", kind: "text", text });
    broadcast({ kind: "message", threadId: bot.threadId, message });
    opts = { ...opts, userMessage: message };
  }
  turnScheduler.enqueue(botId, { text, options: opts }, opts?.commsDepth ? "background" : "normal");
  store.patchBot(botId, { busy: true, unread: false });
  broadcastBot(store.bot(botId));
  if (!turnScheduler.isActive(botId)) void drainBotQueue(botId);
  return { queued: true, queueDepth: turnScheduler.depth(botId) - (turnScheduler.isActive(botId) ? 1 : 0) };
}

// ── config hot-reload ─────────────────────────────────────────────────
// ── group turn engine ──────────────────────────────────────────────────
// Room messages go to the configured default responder unless the user
// explicitly @mentions members. Responders run SEQUENTIALLY (one speaker at
// a time — the transcript and streaming bubble stay coherent), each on a
// fresh session with recent room context. A member's reply may @mention
// teammates; those get one chained turn (hop 1), never deeper.
const groupQueues = new Map<string, Promise<void>>();
const GROUP_CONTEXT_MESSAGES = 30;
const MAX_GROUP_HOPS = 1;

function serializeRoomContext(threadId: string, userName: string): string {
  return store
    .messagesFor(threadId)
    .filter((m) => m.kind === "text" && m.text)
    .slice(-GROUP_CONTEXT_MESSAGES)
    .map((m) => `${m.role === "user" ? userName : (m.from?.name ?? "Bot")}: ${m.text}`)
    .join("\n");
}

function broadcastGroup(groupId: string) {
  const group = store.group(groupId);
  if (group) broadcast({ kind: "group", group });
}

async function runGroupMemberTurn(
  groupId: string,
  botId: string,
  hop: number,
  // bots that already spoke for this user message — "@Scout ask @Pixel"
  // must not run Pixel twice (once chained, once as a direct responder)
  reasoningLevel?: ReasoningLevel,
  spoken: Set<string> = new Set(),
): Promise<void> {
  const group = store.group(groupId);
  const bot = store.bot(botId);
  if (!group || !bot) return;
  spoken.add(botId);
  const instance = registry.get(bot.modelSelection.instanceId);
  const userName = cfg.profile?.name?.trim() || "User";
  if (!instance) {
    const failure = store.appendMessage(group.threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: `error: ${bot.name}'s model is unavailable`, ok: false },
    });
    broadcast({ kind: "message", threadId: group.threadId, message: failure });
    return;
  }
  const reasoningEffort = reasoningEffortForLevel(reasoningLevel);
  const turnModel = modelForReasoningLevel(instance.models, bot.modelSelection.model, reasoningLevel);

  store.patchGroup(group.id, { busyBotId: bot.id });
  broadcastGroup(group.id);
  groupSpeakers.set(group.threadId, { botId: bot.id, name: bot.name, color: bot.color });

  const roster = group.memberIds
    .map((id) => store.bot(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
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

  // run the turn and wait for it to settle, folding the reply text so a
  // chained @mention can be routed afterwards
  let replyText = "";
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const unsub = bus.subscribe((e: RuntimeEvent) => {
      if (e.threadId !== group.threadId) return;
      if (e.type === "item.completed" && e.itemType === "assistant_text") replyText += `\n${e.text}`;
      else if (e.type === "turn.completed") finish();
    });
    const timer = setTimeout(finish, 5 * 60_000);
    instance.adapter
      .sendTurn({
        threadId: group.threadId,
        text,
        system,
        permissionMode: bot.autoApprove ? "auto" : "ask",
        model: turnModel,
        reasoningEffort,
      })
      .catch((err) => {
        const failure = store.appendMessage(group.threadId, {
          role: "bot",
          kind: "activity",
          from: { botId: bot.id, name: bot.name, color: bot.color },
          tool: { name: `error: ${err instanceof Error ? err.message.slice(0, 140) : "turn failed"}`, ok: false },
        });
        broadcast({ kind: "message", threadId: group.threadId, message: failure });
        finish();
      });
  });
  groupSpeakers.delete(group.threadId);
  store.patchGroup(group.id, { busyBotId: null, unread: true });
  broadcastGroup(group.id);

  // chained mentions: a member's reply can summon teammates — one hop only
  if (hop < MAX_GROUP_HOPS && replyText.trim()) {
    const members = group.memberIds
      .map((id) => store.bot(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.id !== bot.id);
    for (const next of roomResponders(replyText, members, { kind: "mentions" })) {
      if (spoken.has(next.id)) continue;
      await runGroupMemberTurn(groupId, next.id, hop + 1, reasoningLevel, spoken);
    }
  }
}

function startGroupTurn(groupId: string, text: string, reasoningLevel?: ReasoningLevel) {
  const group = store.group(groupId);
  if (!group) throw Object.assign(new Error("no such group"), { status: 404 });
  const userMessage = store.appendMessage(group.threadId, { role: "user", kind: "text", text });
  broadcast({ kind: "message", threadId: group.threadId, message: userMessage });

  const members = group.memberIds
    .map((id) => store.bot(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));
  let responders = roomResponders(text, members, group.defaultResponder);
  // bot⇄bot channels: chipping in without a tag addresses the last speaker
  if (!responders.length && group.dm) {
    const lastSpeakerId = [...store.messagesFor(group.threadId)]
      .reverse()
      .find((msg) => msg.kind === "text" && msg.from)?.from?.botId;
    const last = members.find((b) => b.id === lastSpeakerId) ?? members[0];
    responders = last ? [last] : [];
  }
  if (!responders.length) return;

  const prev = groupQueues.get(groupId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const spoken = new Set<string>();
    for (const responder of responders) {
      if (spoken.has(responder.id)) continue;
      await runGroupMemberTurn(groupId, responder.id, 0, reasoningLevel, spoken);
    }
  });
  groupQueues.set(groupId, next.catch(() => {}));
}

function configStatus() {
  return {
    xai: { configured: Boolean(cfg.xai?.key) },
    gemini: { configured: Boolean(cfg.gemini?.key) },
    anthropic: { configured: Boolean(cfg.anthropic?.key) },
    openai: { configured: Boolean(cfg.openai?.key) },
    domestic: Object.fromEntries(
      DOMESTIC_PROVIDER_IDS.map((providerId) => [
        providerId,
        { configured: Boolean(cfg.domestic?.[providerId]?.key) },
      ]),
    ),
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
    cloudLeaseByThread.get(b.threadId)?.();
    cloudLeaseByThread.delete(b.threadId);
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
function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function readBytes(req: IncomingMessage, maxBytes = 25_000_000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (message: string, status: number) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      (error as Error & { status?: number }).status = status;
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail("录音文件过大", 413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function requestHostName(host: string | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : null;
  }
  return value.split(":", 1)[0] || null;
}

function isLoopbackHost(host: string | undefined): boolean {
  const hostname = requestHostName(host);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isLoopbackHost(parsed.hostname)
    );
  } catch {
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
        if (!store.bot(botId)) return json(res, 404, { error: "no such bot" });
        if (method === "GET") return json(res, 200, computerControl.snapshot(botId));
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
        if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
        if (toBotId === fromBotId) return json(res, 400, { error: "a bot cannot message itself" });
        if (depth >= MAX_COMMS_DEPTH) return json(res, 200, { error: "message chains are limited to one hop" });
        const target = store.bot(toBotId);
        if (!target) return json(res, 404, { error: "no such bot" });
        const from = store.bot(fromBotId);
        const fromName = from?.name ?? "another bot";

        // the exchange is mirrored into a bot⇄bot channel: it shows up in
        // the sidebar like any room, keeps the pair's full history, and the
        // user can open it and chip in
        let channel = from ? store.dmGroup(from.id, target.id) : undefined;
        if (from && !channel) {
          channel = store.createGroup(`${from.name} ⇄ ${target.name}`, [from.id, target.id], true);
        }
        const mirror = (speaker: { id: string; name: string; color: string }, text: string) => {
          if (!channel || !text.trim()) return;
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
        const chip = (
          threadId: string,
          label: string,
          withBot: { id: string; name: string; color: string },
        ) => {
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
        const handoff: HandoffRecord = {
          id: newId(),
          fromBotId,
          toBotId,
          status: "queued",
          createdAt: Date.now(),
        };
        handoffs.set(handoff.id, handoff);
        broadcast({ kind: "handoff", handoff });
        void (async () => {
          handoff.status = "running";
          broadcast({ kind: "handoff", handoff });
          const reply = await askBotAndWait(toBotId, prefixed, depth);
          handoff.status = reply.startsWith("(couldn't") || reply.startsWith("(timed out") ? "failed" : "completed";
          handoff.result = reply;
          handoff.finishedAt = Date.now();
          if (from) {
            mirror(target, reply);
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
      const client: SseClient = { res, screens: url.searchParams.get("screens") !== "off" };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const replay = sseReplay.resume(
        url.searchParams.get("since") ?? req.headers["last-event-id"],
        (kind) => wantsSseKind(client, kind),
      );
      res.write(`data: ${JSON.stringify({ kind: "hello", cursor: replay.cursor, resumed: replay.resumed })}\n\n`);
      for (const frame of replay.frames) res.write(frame);
      sseClients.add(client);
      const keepalive = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {}
      }, 25_000);
      req.on("close", () => {
        clearInterval(keepalive);
        sseClients.delete(client);
      });
      return;
    }

    // Image attachments are stored outside the transcript and referenced by
    // generated filenames, so prompt paths never expose an original name.
    if (method === "POST" && path === "/api/attachments") {
      const rawType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
      const mime = rawType?.split(";")[0]?.trim().toLowerCase();
      if (!mime || !extensionForMime(mime)) return json(res, 400, { error: "content-type must be a supported image type" });
      const saved = await new Promise<SavedAttachment>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;
        const fail = (status: number, message: string) => {
          if (settled) return;
          settled = true;
          reject(Object.assign(new Error(message), { status }));
        };
        req.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.byteLength;
          if (received > IMAGE_MAX_BYTES) return fail(413, `image exceeds ${IMAGE_MAX_BYTES} bytes`);
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (settled) return;
          settled = true;
          try { resolve(saveImage(Buffer.concat(chunks), mime)); }
          catch (error) { reject(error); }
        });
        req.on("error", (error) => fail(400, error instanceof Error ? error.message : String(error)));
      });
      return json(res, 201, saved);
    }
    const attachmentMatch = path.match(/^\/api\/attachments\/([\w.-]+)$/);
    if (method === "GET" && attachmentMatch) {
      const attachment = readAttachment(attachmentMatch[1]!);
      if (!attachment) return json(res, 404, { error: "no such attachment" });
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
      if (!normalized) return json(res, 200, { hits: [] });

      const snippet = (text: string) => {
        const lower = text.toLocaleLowerCase();
        const match = lower.indexOf(normalized);
        const start = Math.max(0, match - 50);
        const end = Math.min(text.length, match + query.length + 90);
        const compact = text.slice(start, end).replace(/\s+/g, " ").trim();
        return `${start > 0 ? "…" : ""}${compact}${end < text.length ? "…" : ""}`;
      };

      const hits: Array<{
        threadId: string;
        messageId: string;
        at: number;
        role: string;
        snippet: string;
        name: string;
        botId?: string;
        groupId?: string;
        task?: string;
      }> = [];

      for (const bot of store.bots) {
        if (bot.hidden) continue;
        for (const task of store.tasks(bot.id)) {
          for (const message of store.messagesFor(task.threadId)) {
            if (message.kind !== "text" || !message.text?.toLocaleLowerCase().includes(normalized)) continue;
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
          if (message.kind !== "text" || !message.text?.toLocaleLowerCase().includes(normalized)) continue;
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

    // ── rooms (group chats) ─────────────────────────────────────────────
    let m: RegExpMatchArray | null = null;
    if (method === "POST" && path === "/api/groups") {
      const body = await readBody(req);
      const memberIds = (Array.isArray(body.memberIds) ? body.memberIds : []).filter(
        (id: unknown): id is string => typeof id === "string" && Boolean(store.bot(id)),
      );
      if (memberIds.length === 0) return json(res, 400, { error: "a room needs at least one bot" });
      const name =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : `${store.bot(memberIds[0])!.name} & co.`;
      const group = store.createGroup(name, memberIds);
      broadcast({ kind: "group", group });
      return json(res, 201, { group: { ...group, messages: [] } });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const existing = store.group(m[1]);
      if (!existing) return json(res, 404, { error: "no such room" });
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "bulletin", "unread"] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (Array.isArray(body.memberIds)) {
        if (existing.dm) return json(res, 400, { error: "direct channels have fixed membership" });
        if (existing.busyBotId) return json(res, 409, { error: "room membership cannot change while a bot is working" });
        const ids = [...new Set(body.memberIds.filter(
          (id: unknown): id is string => typeof id === "string" && Boolean(store.bot(id)),
        ))];
        if (!ids.length) return json(res, 400, { error: "a room needs at least one bot" });
        patch.memberIds = ids;
      }
      if (body.defaultResponder !== undefined) {
        const value = body.defaultResponder as { kind?: unknown; botId?: unknown } | null;
        const memberIds = (patch.memberIds as string[] | undefined) ?? existing.memberIds;
        let responder: GroupDefaultResponder | null = null;
        if (value?.kind === "everyone") responder = { kind: "everyone" };
        else if (value?.kind === "mentions") responder = { kind: "mentions" };
        else if (value?.kind === "member" && typeof value.botId === "string" && memberIds.includes(value.botId)) {
          responder = { kind: "member", botId: value.botId };
        }
        if (!responder) return json(res, 400, { error: "invalid default responder" });
        patch.defaultResponder = responder;
      }
      const group = store.patchGroup(m[1], patch);
      if (!group) return json(res, 404, { error: "no such room" });
      broadcast({ kind: "group", group });
      return json(res, 200, { group });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such room" });
      store.deleteGroup(group.id);
      for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
        try {
          unlinkSync(join(dir, `${group.threadId}.ndjson`));
        } catch {}
      }
      broadcast({ kind: "group.deleted", groupId: group.id });
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)\/messages$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      const reasoningLevel = parseReasoningRequest(body.reasoningLevel, body.reasoningEffort);
      startGroupTurn(m[1], text, reasoningLevel);
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such room" });
      const busy = group.busyBotId ? store.bot(group.busyBotId) : undefined;
      const instance = busy ? registry.get(busy.modelSelection.instanceId) : undefined;
      await instance?.adapter.interruptTurn(group.threadId).catch(() => {});
      return json(res, 200, { ok: true });
    }

    // emoji reactions — works on any thread (1:1 or room)
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/reactions$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const emoji = String(body.emoji ?? "").slice(0, 8);
      if (!emoji) return json(res, 400, { error: "emoji required" });
      const patched = store.toggleReaction(m[1], m[2], emoji, typeof body.by === "string" ? body.by : "user");
      if (!patched) return json(res, 404, { error: "no such message" });
      broadcast({ kind: "message.patch", threadId: m[1], message: patched });
      return json(res, 200, { message: patched });
    }
    if (method === "POST" && path === "/api/bots") {
      const bot = store.createBot();
      store.patchBot(bot.id, { modelSelection: await defaultSelection() });
      return json(res, 201, { bot: wireBotWithThread(store.bot(bot.id)!) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "title", "description", "notifications", "modelSelection", "unread", "computer", "color", "mascotShape", "mascotExpression", "pinned", "hidden"] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
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
        if (typeof body.autoApprove !== "boolean") return json(res, 400, { error: "autoApprove must be true or false" });
        patch.autoApprove = body.autoApprove;
      }
      if (body.alwaysAllow !== undefined) {
        if (!Array.isArray(body.alwaysAllow) || body.alwaysAllow.some((t: unknown) => typeof t !== "string")) {
          return json(res, 400, { error: "alwaysAllow must be a list of tool keys" });
        }
        patch.alwaysAllow = [...new Set(body.alwaysAllow as string[])].slice(0, 200);
      }
      if (body.voiceProfile !== undefined) {
        if (body.voiceProfile === null) {
          patch.voiceProfile = null;
        } else if (typeof body.voiceProfile === "object") {
          const value = body.voiceProfile as { voice?: unknown; speed?: unknown; gain?: unknown };
          const voice = typeof value.voice === "string" ? value.voice.trim().slice(0, 240) : "";
          if (!voice) return json(res, 400, { error: "voiceProfile.voice is required" });
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
        } else {
          return json(res, 400, { error: "voiceProfile must be an object or null" });
        }
      }
      const bot = store.patchBot(m[1], patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const chiefChanges =
        body.chiefOfStaff === true
          ? store.setChiefOfStaff(bot.id)
          : body.chiefOfStaff === false && bot.chiefOfStaff
            ? store.setChiefOfStaff(null)
            : [];
      if (chiefChanges === null) return json(res, 404, { error: "no such bot" });
      const changed = new Map([[bot.id, store.bot(bot.id)!]]);
      for (const changedBot of chiefChanges) changed.set(changedBot.id, changedBot);
      for (const changedBot of changed.values()) broadcastBot(changedBot);
      return json(res, 200, { bot: wireBot(store.bot(bot.id)!) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // a running turn dies with its bot
      pendingCloudLeaseByThread.get(bot.threadId)?.abort();
      pendingCloudLeaseByThread.delete(bot.threadId);
      await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
      stopScreenPoller(bot.id);
      store.deleteBot(bot.id);
      for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
        try {
          unlinkSync(join(dir, `${bot.threadId}.ndjson`));
        } catch {}
      }
      broadcast({ kind: "bot.deleted", botId: bot.id });
      return json(res, 200, { ok: true });
    }

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
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
      if (!text) return json(res, 400, { error: "text required" });
      const reasoningLevel = parseReasoningRequest(body.reasoningLevel, body.reasoningEffort);
      const queued = await startTurn(m[1], text, { reasoningLevel });
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
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      // everything from here down is synchronous, so two racing edits can
      // never both get past this check: startTurn flips busy before the
      // next request is handled
      if (bot.busy) return json(res, 409, { error: "the bot is working — stop it before editing" });
      const source = store.messagesFor(bot.threadId).find((msg) => msg.id === messageId);
      if (!source || source.role !== "user" || source.kind !== "text") {
        return json(res, 404, { error: "only user messages can be edited" });
      }
      if (!registry.get(bot.modelSelection.instanceId)) {
        return json(res, 409, {
          error: `provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`,
        });
      }
      const message = store.branchMessage(bot.threadId, messageId, text);
      if (!message) return json(res, 404, { error: "no such message" });
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
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (bot.busy) return json(res, 409, { error: "the bot is working — stop it before switching versions" });
      const body = await readBody(req);
      const leaf = store.setActiveLeaf(bot.threadId, String(body.messageId ?? ""));
      if (!leaf) return json(res, 404, { error: "no such message" });
      // provider sessions still hold the other branch — next turn replays
      store.patchBot(bot.id, { rewound: true });
      broadcast({ kind: "thread", threadId: bot.threadId, activeLeafId: leaf });
      return json(res, 200, { activeLeafId: leaf });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const instance = registry.get(bot.modelSelection.instanceId);
      if (!instance) return json(res, 409, { error: "provider unavailable" });
      await instance.adapter.respondToRequest(bot.threadId, String(body.requestId), {
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
      const group = store.groupByThread(threadId);
      const owner = group ? (group.busyBotId ? store.bot(group.busyBotId) : undefined) : store.botByThread(threadId);
      if (!owner) return json(res, 404, { error: "nothing is waiting on an answer in this conversation" });
      const instance = registry.get(owner.modelSelection.instanceId);
      if (!instance) return json(res, 409, { error: "provider unavailable" });
      await instance.adapter.respondToRequest(threadId, String(body.requestId), {
        behavior: body.behavior,
        message: body.message,
      });
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const cancelled = turnScheduler.cancelQueued(bot.id);
      const instance = registry.get(bot.modelSelection.instanceId);
      pendingCloudLeaseByThread.get(bot.threadId)?.abort();
      pendingCloudLeaseByThread.delete(bot.threadId);
      await instance?.adapter.interruptTurn(bot.threadId);
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
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (bot.busy) return json(res, 409, { error: "this bot is working — let it finish before starting a task" });
      const body = await readBody(req);
      const task = store.createTask(bot.id, typeof body.title === "string" ? body.title : undefined);
      if (!task) return json(res, 500, { error: "couldn't create that task" });
      const fresh = wireBotWithThread(store.bot(bot.id)!);
      broadcastBot(store.bot(bot.id), true);
      return json(res, 201, { bot: fresh, task: wireTask(task) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/);
    if (m && method === "POST") {
      const switched = store.switchTask(m[1], m[2]);
      if (!switched) return json(res, 404, { error: "no such task" });
      const fresh = wireBotWithThread(switched);
      broadcastBot(switched, true);
      return json(res, 200, { bot: fresh });
    }
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const task = store.renameTask(m[1], m[2], String(body.title ?? ""));
      if (!task) return json(res, 404, { error: "no such task" });
      broadcastBot(store.bot(m[1]), true);
      return json(res, 200, { task: wireTask(task) });
    }
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (bot?.busy && bot.threadId === m[2]) {
        return json(res, 409, { error: "this task is running — stop it first" });
      }
      const updated = store.deleteTask(m[1], m[2]);
      if (!updated) return json(res, 400, { error: "a bot keeps at least one task" });
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
      return json(res, 200, { instances: await registry.describe() });
    }

    // ── app config (API keys — never echoed back, booleans only) ──
    if (method === "GET" && path === "/api/config") {
      return json(res, 200, configStatus());
    }
    if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
      const body = await readBody(req);
      const patch: Record<string, object> = {};
      for (const key of ["xai", "gemini", "anthropic", "openai", "domestic", "composio", "box", "profile", "voice"] as const) {
        if (body[key] && typeof body[key] === "object") patch[key] = body[key];
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
      // check a box token against the provider before storing it: a
      // rejected token used to save happily and only surface as a 401 in
      // another panel later, with nothing the user could act on
      const newBoxToken = (patch.box as { token?: unknown } | undefined)?.token;
      if (typeof newBoxToken === "string" && newBoxToken.trim()) {
        const check = await box.verifyToken(newBoxToken.trim());
        if (!check.ok) return json(res, 400, { error: check.message });
      }
      saveConfig(patch);
      Object.assign(cfg, loadConfig());
      // provider keys change the fleet; a profile edit must not kill
      // in-flight turns with a pointless reload
      if (Object.keys(patch).some((k) => !["profile", "voice"].includes(k))) await reloadProviders();
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
      if (botId && !bot) return json(res, 404, { error: "no such bot" });
      const inline = body.tuning && typeof body.tuning === "object"
        ? body.tuning as { voice?: string; speed?: number; gain?: number }
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
      const section = m[1] as RelaySection;
      try {
        const ids = await discoverModels(cfg, section);
        const { instanceId } = saveDiscoveredModels(section, ids);
        Object.assign(cfg, loadConfig());
        await reloadProviders();
        broadcast({ kind: "config", ...configStatus() });
        return json(res, 200, { ok: true, instanceId, count: ids.length });
      } catch (e: any) {
        return json(res, 400, { ok: false, error: e?.message ?? String(e) });
      }
    }

    // ── connectors (Composio) ──
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source } = await composio.listToolkits(cfg);
      return json(res, 200, { configured: Boolean(cfg.composio?.key), source, cards });
    }
    if (method === "GET" && path === "/api/connectors") {
      const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
      if (!cfg.composio?.key) return json(res, 200, { configured: false, services: {} });
      const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
      return json(res, 200, { configured: true, services: status });
    }
    m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
    if (m && method === "POST") return json(res, 200, await composio.authorizeService(cfg, m[1]));
    m = path.match(/^\/api\/connectors\/([\w-]+)$/);
    if (m && method === "DELETE") return json(res, 200, await composio.removeService(cfg, m[1]));

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
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (method === "POST" && path === "/api/mcp/servers") {
      try {
        const next = mcp.upsertMcpServer(cfg, await readBody(req));
        replaceMcpServers(next.servers);
        Object.assign(cfg, loadConfig());
        return json(res, 201, { server: mcp.publicMcpServers(cfg).find((server) => server.id === next.id) });
      } catch (error) {
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
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (m && method === "DELETE") {
      const servers = mcp.deleteMcpServer(cfg, m[1]);
      if (!servers) return json(res, 404, { error: "no such MCP server" });
      replaceMcpServers(servers);
      Object.assign(cfg, loadConfig());
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/mcp\/servers\/([a-z][\w-]{0,31})\/test$/);
    if (m && method === "POST") {
      const id = m[1];
      const server = cfg.mcp?.servers?.[id];
      if (!server) return json(res, 404, { error: "no such MCP server" });
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
      } catch (error) {
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
      if (!store.bot(botId)) return json(res, 404, { error: "no such bot" });
      if (method === "GET") return json(res, 200, computerControl.snapshot(botId));
      const body = await readBody(req);
      const action = String(body.action ?? "");
      let snapshot;
      if (action === "take") snapshot = computerControl.take(botId);
      else if (action === "release") snapshot = computerControl.release(botId);
      else if (action === "dismiss-help") snapshot = computerControl.dismissHelp(botId);
      else return json(res, 400, { error: "action must be take, release, or dismiss-help" });
      broadcastComputerControl(botId);
      return json(res, 200, snapshot);
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
    if (m && method === "GET") return json(res, 200, await box.boxStatus(cfg, m[1]));
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|replace|join|sleep|exec|screenshot)$/);
    if (m && method === "POST") {
      const botId = m[1];
      const bot = store.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      switch (m[2]) {
        case "provision":
          return json(
            res,
            200,
            await box.provisionBox(cfg, botId, bot.name, (state) =>
              broadcast({ kind: "computer", botId, state }),
            ),
          );
        case "replace": {
          const body = await readBody(req);
          return json(
            res,
            200,
            await box.replaceAllBoxes(cfg, bot.name, String(body.confirm ?? ""), (state) =>
              broadcast({ kind: "computer", botId, state }),
            ),
          );
        }
        case "join":
          return json(res, 200, await box.joinBox(cfg, botId));
        case "sleep":
          return json(res, 200, await box.sleepBox(cfg, botId));
        case "exec": {
          const body = await readBody(req);
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
      } catch {
        // SPA fallback
        try {
          const data = readFileSync(join(STATIC_DIR, "index.html"));
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(data);
        } catch {
          /* fall through to 404 */
        }
      }
    }

    return json(res, 404, { error: `no route: ${method} ${path}` });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    return json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`openmausbot server on http://127.0.0.1:${PORT}`);
});

let shutdownPromise: Promise<void> | null = null;
function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    for (const controller of pendingCloudLeaseByThread.values()) controller.abort();
    pendingCloudLeaseByThread.clear();
    for (const release of cloudLeaseByThread.values()) release();
    cloudLeaseByThread.clear();
    await registry.disposeAll();
    for (const client of sseClients) {
      try { client.res.end(); } catch {}
    }
    sseClients.clear();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
