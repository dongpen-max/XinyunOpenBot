// Model discovery for relay gateways ("中转站"). A relay speaks the
// OpenAI-compatible `GET {base}/models` shape, so one probe covers all
// three proxy sections — Anthropic-style relays answer it too, since
// nearly every gateway fronts an OpenAI-shaped router.
//
// The catalog is written into cfg.instances[<id>].config.models so the
// model picker (which renders whatever /api/instances reports) picks it
// up on the next provider reload. Nothing here trusts the relay: the
// response is untrusted input, so ids are filtered to a conservative
// charset and the list is capped.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR, type AppConfig } from "./config.ts";

/** Proxy section → the instance whose catalog it feeds. */
export const RELAY_TARGETS = {
  anthropic: { instanceId: "claude", label: "Claude (Anthropic)" },
  openai: { instanceId: "codex", label: "Codex (OpenAI)" },
  xai: { instanceId: "grokApi", label: "Grok (xAI)" },
} as const;

export type RelaySection = keyof typeof RELAY_TARGETS;

const MAX_MODELS = 200;
const ID_OK = /^[A-Za-z0-9._:\/-]{1,120}$/;

/** Pull `data[].id` out of an OpenAI-shaped /models payload. */
function parseModelIds(body: unknown): string[] {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as any)?.data)
      ? (body as any).data
      : Array.isArray((body as any)?.models)
        ? (body as any).models
        : [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = typeof row === "string" ? row : row?.id ?? row?.name ?? row?.model;
    if (typeof id === "string" && ID_OK.test(id)) seen.add(id);
    if (seen.size >= MAX_MODELS) break;
  }
  return [...seen].sort();
}

/** `https://relay/v1/` + `models` without doubling or dropping a slash. */
function modelsUrl(base: string) {
  return `${base.replace(/\/+$/, "")}/models`;
}

/**
 * Probe one relay section's /models endpoint. Returns the discovered ids;
 * throws a message meant for the settings panel on failure.
 */
export async function discoverModels(cfg: AppConfig, section: RelaySection): Promise<string[]> {
  const entry = (cfg as any)[section] as { key?: string; url?: string } | undefined;
  const base = entry?.url?.trim();
  const key = entry?.key?.trim();
  if (!base) throw new Error("先填写并保存中转站 URL");
  if (!key) throw new Error("先填写并保存中转站密钥");

  let res: Response;
  try {
    res = await fetch(modelsUrl(base), {
      headers: { authorization: `Bearer ${key}`, "x-api-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e: any) {
    throw new Error(e?.name === "TimeoutError" ? "中转站 20 秒未响应" : `无法连接中转站: ${e?.message ?? e}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`中转站返回 ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
  const ids = parseModelIds(await res.json().catch(() => null));
  if (!ids.length) throw new Error("中转站没有返回任何模型");
  return ids;
}

/**
 * Persist a discovered catalog onto the section's instance. Merges into
 * whatever instance entry already exists so a hand-written driver/url
 * survives; keeps the previous default when it is still on offer.
 */
export function saveDiscoveredModels(section: RelaySection, ids: string[]): { instanceId: string } {
  const { instanceId } = RELAY_TARGETS[section];
  const p = join(DATA_DIR, "config.json");
  let disk: Record<string, any> = {};
  try {
    disk = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* first write */
  }
  const instances = (disk.instances ??= {});
  const entry = (instances[instanceId] ??= {});
  const cfgBlock = (entry.config ??= {});
  const prior = cfgBlock.models?.default;
  cfgBlock.models = {
    default: typeof prior === "string" && ids.includes(prior) ? prior : ids[0],
    options: ids,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(p, JSON.stringify(disk, null, 2));
  return { instanceId };
}
