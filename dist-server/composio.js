import { PUBLIC_TOOLKIT_CATALOG } from "./composio-public-catalog.js";
const CONNECT_URL = "https://connect.composio.dev/mcp";
const BACKEND_URL = "https://backend.composio.dev/api/v3";
const PUBLIC_TOOLKITS_URL = "https://docs.composio.dev/toolkits";
function parseMcpResponse(text) {
    // Streamable-HTTP servers answer JSON or SSE (`data: {...}` lines).
    const line = text.startsWith("{")
        ? text
        : text.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
    if (!line)
        throw new Error("empty MCP response");
    const msg = JSON.parse(line);
    if (msg.error)
        throw new Error(msg.error.message || "MCP error");
    const content = msg.result?.content?.find((c) => c.type === "text")?.text;
    if (!content)
        return msg.result ?? null;
    try {
        return JSON.parse(content);
    }
    catch {
        return { text: content };
    }
}
export async function composioTool(cfg, name, args) {
    if (!cfg.composio?.key) {
        throw new Error('no Composio key configured — add {"composio":{"key":"ck_…"}} to ~/.openmausbot/config.json');
    }
    const res = await fetch(cfg.composio.url || CONNECT_URL, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "x-consumer-api-key": cfg.composio.key,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
        throw new Error(`Composio MCP: HTTP ${res.status}`);
    return parseMcpResponse(await res.text());
}
/** Connection status per service slug: { slack: { connected, status } }. */
export async function connectionStatus(cfg, slugs) {
    const out = await composioTool(cfg, "COMPOSIO_MANAGE_CONNECTIONS", {
        toolkits: slugs.map((name) => ({ name, action: "list" })),
    });
    const results = out?.data?.results ?? {};
    const status = {};
    for (const slug of slugs) {
        const r = results[slug];
        const active = (r?.accounts ?? []).some((a) => /active/i.test(a.status ?? "")) || /^active$/i.test(r?.status ?? "");
        status[slug] = { connected: active, status: r?.status ?? "unknown" };
    }
    return status;
}
/** Disconnect a service: remove every connected account for the slug. */
export async function removeService(cfg, slug) {
    const out = await composioTool(cfg, "COMPOSIO_MANAGE_CONNECTIONS", {
        toolkits: [{ name: slug, action: "list" }],
    });
    const accounts = out?.data?.results?.[slug]?.accounts ?? [];
    const ids = accounts.map((a) => a.id ?? a.account_id ?? a.nanoid).filter(Boolean);
    for (const id of ids) {
        await composioTool(cfg, "COMPOSIO_MANAGE_CONNECTIONS", {
            toolkits: [{ name: slug, action: "remove", account_id: id }],
        });
    }
    return { removed: ids.length };
}
/** Mint a browser auth link for one service. Returns { url } or throws. */
export async function authorizeService(cfg, slug) {
    const out = await composioTool(cfg, "COMPOSIO_MANAGE_CONNECTIONS", {
        toolkits: [{ name: slug, action: "add" }],
    });
    // be liberal: any https URL mentioning composio/auth wins, else the first
    const raw = JSON.stringify(out);
    const urls = raw.match(/https:\/\/[^"\\\s]+/g) ?? [];
    const url = urls.find((u) => /composio|connect|auth/i.test(u)) ?? urls[0];
    if (!url)
        throw new Error(`Composio returned no auth link for ${slug}`);
    return { url };
}
// Curated fallback — the services agentcal's connectors page ships plus the
// long marketplace tail. Logos resolve client-side:
// logo → favicon(domain) → monogram.
const CURATED = [
    { slug: "slack", label: "Slack", blurb: "Post updates and read channels", domain: "slack.com", logo: null },
    { slug: "github", label: "GitHub", blurb: "Issues, pull requests, and code", domain: "github.com", logo: null },
    { slug: "gmail", label: "Gmail", blurb: "Read and send email", domain: "gmail.com", logo: null },
    { slug: "googlecalendar", label: "Google Calendar", blurb: "Read and create events", domain: "calendar.google.com", logo: null },
    { slug: "googlesheets", label: "Google Sheets", blurb: "Read and update spreadsheets", domain: "sheets.google.com", logo: null },
    { slug: "googledocs", label: "Google Docs", blurb: "Read and write documents", domain: "docs.google.com", logo: null },
    { slug: "googledrive", label: "Google Drive", blurb: "Browse and manage files", domain: "drive.google.com", logo: null },
    { slug: "notion", label: "Notion", blurb: "Pages and databases", domain: "notion.so", logo: null },
    { slug: "linear", label: "Linear", blurb: "Issues and project tracking", domain: "linear.app", logo: null },
    { slug: "sentry", label: "Sentry", blurb: "Errors and alerts", domain: "sentry.io", logo: null },
    { slug: "posthog", label: "PostHog", blurb: "Analytics, feature flags, experiments", domain: "posthog.com", logo: null },
    { slug: "discord", label: "Discord", blurb: "Messages and channels", domain: "discord.com", logo: null },
    { slug: "x", label: "X (Twitter)", blurb: "Post and read on X", domain: "x.com", logo: null },
    { slug: "reddit", label: "Reddit", blurb: "Browse and post", domain: "reddit.com", logo: null },
    { slug: "zapier", label: "Zapier", blurb: "Connect 9,000+ apps", domain: "zapier.com", logo: null },
    { slug: "hubspot", label: "HubSpot", blurb: "CRM search & updates", domain: "hubspot.com", logo: null },
    { slug: "salesforce", label: "Salesforce", blurb: "CRM records and reports", domain: "salesforce.com", logo: null },
    { slug: "jira", label: "Jira", blurb: "Issues and sprints", domain: "atlassian.com", logo: null },
    { slug: "asana", label: "Asana", blurb: "Tasks and projects", domain: "asana.com", logo: null },
    { slug: "trello", label: "Trello", blurb: "Boards and cards", domain: "trello.com", logo: null },
    { slug: "dropbox", label: "Dropbox", blurb: "Files and folders", domain: "dropbox.com", logo: null },
    { slug: "airtable", label: "Airtable", blurb: "Bases and records", domain: "airtable.com", logo: null },
    { slug: "figma", label: "Figma", blurb: "Files and comments", domain: "figma.com", logo: null },
    { slug: "stripe", label: "Stripe", blurb: "Payments and customers", domain: "stripe.com", logo: null },
];
let toolkitCache = null;
/**
 * Marketplace catalog. Tries the v3 toolkits API (official names,
 * descriptions, logos — cached 10 min); falls back to the curated list.
 */
function decodeHtml(value) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}
/**
 * Composio publishes its complete toolkit index as a public documentation
 * page. It is a useful last-resort catalog: it does not expose connection
 * state or tool schemas, but it lets the UI show every available app even
 * when a project API key is missing, expired, or not accepted by the v3 API.
 */
export function parsePublicToolkitCatalog(html) {
    const cards = [];
    const seen = new Set();
    const anchor = /<a\b[^>]*href="\/toolkits\/([a-z0-9][a-z0-9_-]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchor)) {
        const slug = match[1].toLowerCase();
        if (seen.has(slug))
            continue;
        const body = match[2];
        const text = decodeHtml(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        // The first visible text is the toolkit's display name. Some pages put a
        // tool count after it; keep that out of the card title.
        const label = text.split(/\s+\d+\s*$/)[0].trim() || slug.replace(/[_-]+/g, " ");
        seen.add(slug);
        cards.push({
            slug,
            label,
            blurb: "Composio toolkit",
            logo: `https://logos.composio.dev/api/${slug}`,
            domain: null,
        });
    }
    return cards;
}
async function publicToolkitCatalog() {
    const res = await fetch(PUBLIC_TOOLKITS_URL, {
        headers: { accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
        throw new Error(`public toolkit index HTTP ${res.status}`);
    return parsePublicToolkitCatalog(await res.text());
}
export async function listToolkits(cfg) {
    if (toolkitCache && Date.now() - toolkitCache.at < 10 * 60_000) {
        return { cards: toolkitCache.cards, source: "api" };
    }
    // The Connect consumer key (ck_…) authenticates connection management but
    // is not a project API key for the backend catalog. Only send the optional
    // catalog key here; otherwise use the complete public snapshot immediately.
    const backendKey = cfg.composio?.apiKey;
    let apiDiagnostic;
    if (backendKey) {
        // Different Composio deployments have used both x-api-key and Bearer
        // authentication. Try both without ever returning the key to the UI.
        for (const headers of [{ "x-api-key": backendKey }, { authorization: `Bearer ${backendKey}` }]) {
            try {
                const res = await fetch(`${BACKEND_URL}/toolkits?limit=500&sort_by=usage`, {
                    headers,
                    signal: AbortSignal.timeout(15_000),
                });
                if (!res.ok) {
                    apiDiagnostic = `Composio 目录接口 HTTP ${res.status}`;
                    continue;
                }
                const json = await res.json();
                const items = json.items ?? json.data ?? json.toolkits ?? [];
                if (Array.isArray(items) && items.length) {
                    const cards = items
                        .map((t) => ({
                        slug: (t.slug ?? t.key ?? t.name ?? "").toLowerCase(),
                        label: t.name ?? t.slug ?? "",
                        blurb: (t.meta?.description ?? t.description ?? "").slice(0, 90),
                        logo: t.meta?.logo ?? t.logo ?? null,
                        domain: null,
                    }))
                        .filter((t) => t.slug && t.label);
                    if (cards.length) {
                        toolkitCache = { at: Date.now(), cards };
                        return { cards, source: "api" };
                    }
                    apiDiagnostic = "Composio 目录接口返回空列表";
                }
            }
            catch (error) {
                apiDiagnostic = error instanceof Error ? error.message : String(error);
            }
        }
    }
    // Keep the app useful in packaged/offline environments too. The runtime
    // Node process may not have the user's browser proxy, so the checked-in
    // public snapshot is preferred over silently shrinking to 24 curated apps.
    if (PUBLIC_TOOLKIT_CATALOG.length) {
        return { cards: PUBLIC_TOOLKIT_CATALOG, source: "snapshot", diagnostic: apiDiagnostic };
    }
    try {
        const cards = await publicToolkitCatalog();
        if (cards.length)
            return { cards, source: "public", diagnostic: apiDiagnostic };
    }
    catch (error) {
        apiDiagnostic ??= error instanceof Error ? error.message : String(error);
    }
    return { cards: CURATED, source: "curated", diagnostic: apiDiagnostic };
}
export const CURATED_SLUGS = CURATED.map((c) => c.slug);
