// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
import { pickBotName } from "./names.js";
import { writeFileAtomic } from "./atomic.js";
/** What a task is called before its first message names it. */
export const UNTITLED_TASK = "New task";
/** A task's name, taken from the first thing you asked it to do. */
export function titleFromMessage(text) {
    const line = text.trim().split("\n")[0].trim();
    return line.length > 48 ? `${line.slice(0, 47)}…` : line || UNTITLED_TASK;
}
const BOTS_FILE = join(DATA_DIR, "bots.json");
const GROUPS_FILE = join(DATA_DIR, "groups.json");
const messagesFile = (threadId) => join(DATA_DIR, `messages-${threadId}.json`);
const COLORS = [
    "green",
    "blue",
    "red",
    "orange",
    "purple",
    "cyan",
    "pink",
    "yellow",
    "teal",
    "coral",
];
/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, names match case-insensitively, longest name wins (so "@New Bot 2"
 * never half-matches "New Bot"), hidden bots skipped, results deduped.
 * Callers pre-filter the sender out of `peers`. */
export function mentionedBots(text, peers) {
    const candidates = peers
        .filter((p) => !p.hidden && p.name.trim())
        .sort((a, b) => b.name.length - a.name.length);
    const lower = text.toLowerCase();
    const found = [];
    let at = -1;
    while ((at = lower.indexOf("@", at + 1)) !== -1) {
        if (at > 0 && !/\s/.test(text[at - 1]))
            continue; // user@host, not a tag
        const rest = lower.slice(at + 1);
        const hit = candidates.find((p) => rest.startsWith(p.name.toLowerCase()));
        if (hit && !found.includes(hit))
            found.push(hit);
    }
    return found;
}
/** Normalize persisted or API-provided routing. Old rooms did not have this
 * field; giving them their first member as lead fixes the old silent-send
 * behavior without making every prompt fan out to every model. */
export function normalizeGroupDefaultResponder(value, memberIds, dm = false) {
    if (dm)
        return { kind: "mentions" };
    if (value && typeof value === "object") {
        const candidate = value;
        if (candidate.kind === "everyone")
            return { kind: "everyone" };
        if (candidate.kind === "mentions")
            return { kind: "mentions" };
        if (candidate.kind === "member" &&
            typeof candidate.botId === "string" &&
            memberIds.includes(candidate.botId)) {
            return { kind: "member", botId: candidate.botId };
        }
    }
    if (memberIds.length === 0)
        return { kind: "mentions" };
    return { kind: "member", botId: memberIds[0] };
}
/** Resolve the bots invoked by a human room message. Explicit targets win;
 * otherwise the room policy chooses one member, everyone, or nobody. */
export function roomResponders(text, members, defaultResponder) {
    const available = members.filter((member) => !member.hidden);
    if (/(?:^|\s)@everyone\b/i.test(text))
        return available;
    const mentioned = mentionedBots(text, available);
    if (mentioned.length)
        return mentioned;
    if (defaultResponder.kind === "everyone")
        return available;
    if (defaultResponder.kind === "member") {
        const lead = available.find((member) => member.id === defaultResponder.botId);
        return lead ? [lead] : [];
    }
    return [];
}
const onboardingCard = () => ({
    title: "What do you mostly want help with?",
    subtitle: "Pick whatever's closest; we can always expand from there.",
    options: ["Work & projects", "Writing & research", "Life admin", "A bit of everything"],
});
export class Store {
    bots = [];
    groups = [];
    threads = new Map();
    defaultSelection;
    constructor(defaultSelection) {
        this.defaultSelection = defaultSelection;
        mkdirSync(DATA_DIR, { recursive: true });
        try {
            this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
        }
        catch {
            this.bots = [];
        }
        try {
            this.groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
        }
        catch {
            this.groups = [];
        }
        // busy never survives a restart — no turn does either. Rooms saved
        // before default responders existed adopt their first member as lead.
        let botsMigrated = false;
        let chiefSeen = false;
        let groupsMigrated = false;
        for (const b of this.bots) {
            b.busy = false;
            if (!b.chiefOfStaff)
                continue;
            if (!chiefSeen) {
                chiefSeen = true;
                if (b.hidden) {
                    b.hidden = false;
                    botsMigrated = true;
                }
                continue;
            }
            b.chiefOfStaff = false;
            botsMigrated = true;
        }
        for (const g of this.groups) {
            g.busyBotId = null;
            const normalized = normalizeGroupDefaultResponder(g.defaultResponder, g.memberIds, Boolean(g.dm));
            if (JSON.stringify(normalized) !== JSON.stringify(g.defaultResponder))
                groupsMigrated = true;
            g.defaultResponder = normalized;
        }
        if (botsMigrated)
            this.saveBots();
        if (groupsMigrated)
            this.saveGroups();
        // bots saved before tasks existed have one endless thread; adopt it as
        // their first task so nothing is lost and nothing special-cases it
        for (const b of this.bots) {
            if (b.tasks?.length)
                continue;
            b.tasks = [
                {
                    threadId: b.threadId,
                    title: this.firstUserLine(b.threadId) ?? UNTITLED_TASK,
                    createdAt: b.createdAt,
                    resumeCursors: b.resumeCursors ?? {},
                },
            ];
        }
    }
    saveBots() {
        writeFileAtomic(BOTS_FILE, JSON.stringify(this.bots, null, 2));
    }
    saveGroups() {
        writeFileAtomic(GROUPS_FILE, JSON.stringify(this.groups.map(({ busyBotId, ...g }) => g), null, 2));
    }
    // ── groups ────────────────────────────────────────────────────────────
    group(id) {
        return this.groups.find((g) => g.id === id);
    }
    groupByThread(threadId) {
        return this.groups.find((g) => g.threadId === threadId);
    }
    createGroup(name, memberIds, dm = false) {
        const group = {
            id: newId(),
            threadId: newId(),
            name,
            memberIds,
            defaultResponder: dm ? { kind: "mentions" } : { kind: "member", botId: memberIds[0] },
            bulletin: "",
            unread: false,
            createdAt: Date.now(),
            dm: dm || undefined,
            busyBotId: null,
        };
        this.groups.unshift(group);
        this.saveGroups();
        return group;
    }
    /** The bot⇄bot channel for a pair, if it exists (order-insensitive). */
    dmGroup(a, b) {
        return this.groups.find((g) => g.dm && g.memberIds.length === 2 && g.memberIds.includes(a) && g.memberIds.includes(b));
    }
    patchGroup(id, patch) {
        const group = this.group(id);
        if (!group)
            return null;
        Object.assign(group, patch);
        group.defaultResponder = normalizeGroupDefaultResponder(group.defaultResponder, group.memberIds, Boolean(group.dm));
        this.saveGroups();
        return group;
    }
    deleteGroup(id) {
        const group = this.group(id);
        if (!group)
            return false;
        this.groups = this.groups.filter((g) => g.id !== id);
        this.threads.delete(group.threadId);
        this.saveGroups();
        try {
            unlinkSync(messagesFile(group.threadId));
        }
        catch { }
        return true;
    }
    /** Toggle an emoji reaction on a message ("user" or a member botId). */
    toggleReaction(threadId, messageId, emoji, by) {
        const existing = this.messagesFor(threadId).find((m) => m.id === messageId);
        if (!existing)
            return null;
        const reactions = existing.reactions ?? [];
        const at = reactions.findIndex((r) => r.emoji === emoji && r.by === by);
        const next = at >= 0 ? reactions.filter((_, i) => i !== at) : [...reactions, { emoji, by }];
        return this.patchMessage(threadId, messageId, { reactions: next.length ? next : undefined });
    }
    thread(threadId) {
        let t = this.threads.get(threadId);
        if (t)
            return t;
        let messages = [];
        let activeLeafId = null;
        try {
            const raw = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
            if (Array.isArray(raw))
                messages = raw; // pre-branching flat file
            else {
                messages = raw.messages ?? [];
                activeLeafId = raw.activeLeafId ?? null;
            }
        }
        catch {
            /* fresh thread */
        }
        // legacy rows carry no parentId — chain them in array order
        let prev = null;
        for (const m of messages) {
            if (m.parentId === undefined)
                m.parentId = prev;
            prev = m.id;
        }
        if (!activeLeafId)
            activeLeafId = messages.at(-1)?.id ?? null;
        t = { messages, activeLeafId };
        this.threads.set(threadId, t);
        return t;
    }
    saveThread(threadId) {
        const t = this.thread(threadId);
        writeFileAtomic(messagesFile(threadId), JSON.stringify({ activeLeafId: t.activeLeafId, messages: t.messages }, null, 2));
    }
    messagesFor(threadId) {
        return this.thread(threadId).messages;
    }
    activeLeaf(threadId) {
        return this.thread(threadId).activeLeafId;
    }
    /** The visible conversation: root → activeLeafId. */
    activePath(threadId) {
        const t = this.thread(threadId);
        const byId = new Map(t.messages.map((m) => [m.id, m]));
        const path = [];
        let cur = t.activeLeafId ? byId.get(t.activeLeafId) : undefined;
        while (cur) {
            path.push(cur);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return path.reverse();
    }
    appendMessage(threadId, message) {
        const t = this.thread(threadId);
        const full = { id: newId(), at: Date.now(), parentId: t.activeLeafId, ...message };
        t.messages.push(full);
        t.activeLeafId = full.id;
        if (full.kind === "screen")
            this.pruneScreenFrames(t);
        this.saveThread(threadId);
        return full;
    }
    /** Screen frames are ~100-500KB of base64 each and the whole thread file
     * is rewritten on every append, so keeping every frame of a long
     * computer session makes each later message slower than the last. The
     * newest few keep their pixels; older ones stay in the transcript as
     * placeholders. Mirrors the client's own frame cap. */
    pruneScreenFrames(t, keep = 4) {
        let seen = 0;
        for (let i = t.messages.length - 1; i >= 0 && seen < t.messages.length; i--) {
            const m = t.messages[i];
            if (m.kind !== "screen" || !m.png)
                continue;
            seen += 1;
            if (seen > keep)
                m.png = undefined;
        }
    }
    /** Fork the conversation: a new user message that replaces `sourceId`
     * (same parent, new text) and becomes the active leaf. */
    branchMessage(threadId, sourceId, text) {
        const t = this.thread(threadId);
        const source = t.messages.find((m) => m.id === sourceId);
        if (!source)
            return null;
        const full = {
            id: newId(),
            at: Date.now(),
            role: "user",
            kind: "text",
            text,
            parentId: source.parentId ?? null,
        };
        t.messages.push(full);
        t.activeLeafId = full.id;
        this.saveThread(threadId);
        return full;
    }
    /** Point the visible conversation at the branch containing `messageId`,
     * descending to that branch's most recently active leaf. */
    setActiveLeaf(threadId, messageId) {
        const t = this.thread(threadId);
        if (!t.messages.some((m) => m.id === messageId))
            return null;
        let cur = messageId;
        for (;;) {
            const children = t.messages.filter((m) => m.parentId === cur);
            if (!children.length)
                break;
            cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
        }
        t.activeLeafId = cur;
        this.saveThread(threadId);
        return cur;
    }
    patchMessage(threadId, messageId, patch) {
        const t = this.thread(threadId);
        const idx = t.messages.findIndex((m) => m.id === messageId);
        if (idx === -1)
            return null;
        t.messages[idx] = { ...t.messages[idx], ...patch, card: patch.card ?? t.messages[idx].card };
        this.saveThread(threadId);
        return t.messages[idx];
    }
    bot(id) {
        return this.bots.find((b) => b.id === id) ?? null;
    }
    botByThread(threadId) {
        return this.bots.find((b) => b.threadId === threadId) ?? null;
    }
    createBot() {
        const name = pickBotName(this.bots.map((b) => b.name));
        const bot = {
            id: newId(),
            threadId: newId(),
            name,
            title: "",
            description: "",
            notifications: true,
            color: COLORS[this.bots.length % COLORS.length],
            unread: false,
            modelSelection: this.defaultSelection(),
            resumeCursors: {},
            createdAt: Date.now(),
        };
        bot.tasks = [{ threadId: bot.threadId, title: UNTITLED_TASK, createdAt: bot.createdAt, resumeCursors: {} }];
        this.bots.unshift(bot);
        this.saveBots();
        this.appendMessage(bot.threadId, {
            role: "bot",
            kind: "text",
            text: `Hey — I'm ${name}. Nice to meet you.`,
        });
        this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
        return bot;
    }
    deleteBot(id) {
        const bot = this.bot(id);
        if (!bot)
            return false;
        this.bots = this.bots.filter((b) => b.id !== id);
        // every task's transcript goes with the bot, not just the open one
        for (const threadId of new Set([bot.threadId, ...(bot.tasks ?? []).map((t) => t.threadId)])) {
            this.threads.delete(threadId);
            try {
                unlinkSync(messagesFile(threadId));
            }
            catch { }
        }
        this.saveBots();
        return true;
    }
    patchBot(id, patch) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        Object.assign(bot, patch);
        this.saveBots();
        return bot;
    }
    /** Elect one coordinator, or clear the role, and return all changed bots. */
    setChiefOfStaff(id) {
        if (id && !this.bot(id))
            return null;
        const changed = [];
        for (const bot of this.bots) {
            const next = bot.id === id;
            if (Boolean(bot.chiefOfStaff) === next && !(next && bot.hidden))
                continue;
            bot.chiefOfStaff = next;
            if (next)
                bot.hidden = false;
            changed.push(bot);
        }
        if (changed.length)
            this.saveBots();
        return changed;
    }
    setResumeCursor(botId, instanceId, cursor) {
        const bot = this.bot(botId);
        if (!bot)
            return;
        // the cursor belongs to the task that produced it, not to the bot
        const task = this.activeTask(botId);
        if (task)
            task.resumeCursors[instanceId] = cursor;
        bot.resumeCursors[instanceId] = cursor; // legacy mirror
        this.saveBots();
    }
    // ── tasks ─────────────────────────────────────────────────────────────
    /** The first thing the human asked in a thread — a task's natural name. */
    firstUserLine(threadId) {
        const first = this.messagesFor(threadId).find((m) => m.role === "user" && m.kind === "text" && m.text?.trim());
        return first?.text ? titleFromMessage(first.text) : null;
    }
    tasks(botId) {
        return this.bot(botId)?.tasks ?? [];
    }
    activeTask(botId) {
        const bot = this.bot(botId);
        return bot?.tasks?.find((t) => t.threadId === bot.threadId);
    }
    taskByThread(botId, threadId) {
        return this.bot(botId)?.tasks?.find((task) => task.threadId === threadId);
    }
    /** A fresh context on the same bot: new thread, new session, same
     * persona/tools/computer. Becomes the active task. */
    createTask(botId, title) {
        const bot = this.bot(botId);
        if (!bot)
            return null;
        const task = {
            threadId: newId(),
            title: title?.trim() || UNTITLED_TASK,
            createdAt: Date.now(),
            resumeCursors: {},
        };
        bot.tasks = [task, ...(bot.tasks ?? [])];
        bot.threadId = task.threadId;
        bot.resumeCursors = {}; // legacy mirror follows the active task
        this.saveBots();
        return task;
    }
    switchTask(botId, threadId) {
        const bot = this.bot(botId);
        const task = bot?.tasks?.find((t) => t.threadId === threadId);
        if (!bot || !task)
            return null;
        bot.threadId = task.threadId;
        bot.resumeCursors = { ...task.resumeCursors };
        this.saveBots();
        return bot;
    }
    renameTask(botId, threadId, title) {
        const task = this.bot(botId)?.tasks?.find((t) => t.threadId === threadId);
        if (!task)
            return null;
        task.title = title.trim().slice(0, 80) || UNTITLED_TASK;
        this.saveBots();
        return task;
    }
    /** Fold one completed turn's final totals into its owning task. */
    addTaskUsage(botId, threadId, usage) {
        const task = this.taskByThread(botId, threadId);
        if (!task)
            return null;
        const previous = task.usage ?? { input: 0, output: 0, turns: 0 };
        const input = Number.isFinite(usage.input) ? Math.max(0, Math.trunc(usage.input)) : 0;
        const output = Number.isFinite(usage.output) ? Math.max(0, Math.trunc(usage.output)) : 0;
        task.usage = {
            input: previous.input + input,
            output: previous.output + output,
            turns: previous.turns + 1,
        };
        this.saveBots();
        return task;
    }
    /** Name a task after its first message, once. */
    titleTaskFromFirstMessage(botId, text) {
        const task = this.activeTask(botId);
        if (!task || task.title !== UNTITLED_TASK)
            return;
        task.title = titleFromMessage(text);
        this.saveBots();
    }
    /** Delete a task and its transcript. A bot always keeps one. */
    deleteTask(botId, threadId) {
        const bot = this.bot(botId);
        if (!bot || !bot.tasks || bot.tasks.length < 2)
            return null;
        if (!bot.tasks.some((t) => t.threadId === threadId))
            return null;
        bot.tasks = bot.tasks.filter((t) => t.threadId !== threadId);
        this.threads.delete(threadId);
        try {
            unlinkSync(messagesFile(threadId));
        }
        catch { }
        if (bot.threadId === threadId) {
            bot.threadId = bot.tasks[0].threadId;
            bot.resumeCursors = { ...bot.tasks[0].resumeCursors };
        }
        this.saveBots();
        return bot;
    }
    /** First-run seed: one bot so the app never opens empty — it gets a
     * random friendly name like every other bot. */
    seedIfEmpty() {
        if (this.bots.length)
            return;
        this.createBot();
    }
}
