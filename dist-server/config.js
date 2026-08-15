// Config + data dirs. One file, ~/.openmausbot/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { readFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
// OMB_DATA_DIR isolates test/soak rigs from the user's real fleet.
export const DATA_DIR = process.env.OMB_DATA_DIR ?? join(homedir(), ".openmausbot");
const LEGACY_DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
export function ensureDirs() {
    // one-time migration from the pre-rename data dir — bots, transcripts,
    // config and keys all carry over
    if (!existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
        try {
            renameSync(LEGACY_DATA_DIR, DATA_DIR);
        }
        catch {
            /* cross-device or busy — fall through to a fresh dir */
        }
    }
    for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR])
        mkdirSync(dir, { recursive: true });
}
export function loadConfig() {
    let cfg = {};
    try {
        cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    }
    catch {
        /* first run — env fallbacks below */
    }
    // Env vars from .env.local (loaded by server/load-env.ts before this runs)
    // take lowest priority — disk config wins when set.
    cfg.xai = { key: process.env.XAI_API_KEY, url: process.env.XAI_BASE_URL, ...cfg.xai };
    cfg.anthropic = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL, ...cfg.anthropic };
    cfg.openai = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL, ...cfg.openai };
    cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
    cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
    cfg.voice = {
        ...cfg.voice,
        stt: {
            key: process.env.OMB_STT_API_KEY,
            url: process.env.OMB_STT_BASE_URL,
            model: process.env.OMB_STT_MODEL,
            language: process.env.OMB_STT_LANGUAGE,
            ...cfg.voice?.stt,
        },
        tts: {
            key: process.env.OMB_TTS_API_KEY,
            url: process.env.OMB_TTS_BASE_URL,
            model: process.env.OMB_TTS_MODEL,
            voice: process.env.OMB_TTS_VOICE,
            ...cfg.voice?.tts,
        },
    };
    return cfg;
}
/** Merge a partial config into ~/.openmausbot/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch) {
    const p = join(DATA_DIR, "config.json");
    let disk = {};
    try {
        disk = JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        /* first write */
    }
    for (const key of ["xai", "anthropic", "openai", "composio", "box", "profile"]) {
        if (patch[key] && typeof patch[key] === "object") {
            disk[key] = { ...disk[key], ...patch[key] };
        }
    }
    if (patch.voice && typeof patch.voice === "object") {
        const previous = (disk.voice ?? {});
        disk.voice = {
            ...previous,
            ...patch.voice,
            ...(patch.voice.stt ? { stt: { ...previous.stt, ...patch.voice.stt } } : {}),
            ...(patch.voice.tts ? { tts: { ...previous.tts, ...patch.voice.tts } } : {}),
        };
    }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(p, JSON.stringify(disk, null, 2));
}
export function instanceConfigs(cfg) {
    // The default `grok` instance rides the `grokAgent` driver, not the API-key
    // one: like claude and codex it needs no credential from us, just the CLI
    // installed and logged in (it shows up unavailable otherwise). The API-key
    // `grok` driver stays registered but out of the default fleet — that key is
    // a credential Milind doesn't want to manage; an `instances` entry brings
    // it back anytime.
    //
    // Google rides `antigravityAgent` (the `agy` CLI), not `geminiAgent`:
    // Google retired Gemini CLI for the free/Pro/Ultra tiers on 2026-06-18
    // (developers.googleblog.com, "transitioning Gemini CLI to Antigravity
    // CLI"), so a default `gemini` instance could only ever show unavailable.
    // The driver stays registered for enterprise licences, which keep Gemini
    // CLI — `{"instances": {"gemini": {"driver": "geminiAgent"}}}` restores it.
    //
    // Custom instances are ADDITIVE — they layer onto the default fleet rather
    // than replacing it, so adding a relay never silently drops Claude or the
    // cloud computer. Reusing a default instanceId overrides that entry (a
    // shallow per-entry merge, so `{"claude":{"config":…}}` keeps its driver);
    // `enabled: false` is the explicit way to drop one from the fleet.
    const map = {
        grok: { driver: "grokAgent" },
        kimi: { driver: "kimiAgent" },
        claude: { driver: "claudeAgent" },
        codex: { driver: "codex" },
        antigravity: { driver: "antigravityAgent" },
        computer: { driver: "boxAgent" },
    };
    // Apply custom instances (additive merge)
    for (const [instanceId, entry] of Object.entries(cfg.instances ?? {})) {
        map[instanceId] = { ...map[instanceId], ...entry };
    }
    // Remove explicitly disabled instances
    for (const [instanceId, entry] of Object.entries(map)) {
        if (entry.enabled === false)
            delete map[instanceId];
    }
    // Config-file keys are injected as per-instance environment so drivers
    // see them without needing real process env vars.
    for (const entry of Object.values(map)) {
        entry.environment = {
            // xAI — for both grokApi (REST) and grokAgent (CLI gateway)
            ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
            ...(cfg.xai?.url ? { XAI_BASE_URL: cfg.xai.url } : {}),
            // Anthropic — forwarded to claudeAgent when a custom gateway is set
            ...(cfg.anthropic?.key ? { ANTHROPIC_API_KEY: cfg.anthropic.key } : {}),
            ...(cfg.anthropic?.url ? { ANTHROPIC_BASE_URL: cfg.anthropic.url } : {}),
            // OpenAI — forwarded to codex when a custom gateway is set
            ...(cfg.openai?.key ? { OPENAI_API_KEY: cfg.openai.key } : {}),
            ...(cfg.openai?.url ? { OPENAI_BASE_URL: cfg.openai.url } : {}),
            ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
            ...entry.environment,
        };
    }
    return map;
}
