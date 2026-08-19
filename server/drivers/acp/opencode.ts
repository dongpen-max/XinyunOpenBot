// OpenCode harness support — the official `opencode` CLI over ACP stdio.
// The protocol runtime remains in acp/core.ts; this file only adapts
// OpenCode's CLI, auth, model catalogue, and ACP-native model switch.
import { execCli } from "../../procs.ts";
import type { AcpConfig, AcpMcpToolNormalization, AcpSupport } from "./core.ts";
import { createAcpDriver } from "./core.ts";
import type { ModelCatalog } from "../../contracts.ts";
import type { McpIntegration } from "../../mcp.ts";

const EMPTY_MODELS: ModelCatalog = { default: "", options: [] };
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const NON_CHAT_MODEL = /(?:^|[-_\s/.])(image|images|embedding|embeddings|audio|tts|whisper|speech|rerank|moderation|video|veo|lyria|music)(?:$|[-_\s/.])/i;
const XINYUN_PROVIDER_ENV = [
  "XAI_API_KEY",
  "XAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "ZHIPU_API_KEY",
  "ZHIPU_BASE_URL",
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
  "MOONSHOT_API_KEY",
  "MOONSHOT_BASE_URL",
  "COMPOSIO_KEY",
  "COMPOSIO_API_KEY",
  "BOX_TOKEN",
] as const;

const sanitizeMcpIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

export function normalizeOpenCodeMcpTool(
  name: string,
  integrations: McpIntegration[] | undefined,
): AcpMcpToolNormalization {
  if (!integrations?.length) return { name };

  const matches: Array<{ serverId: string; tool: string }> = [];
  for (const integration of integrations) {
    const knownTools = integration.allowedTools !== undefined
      ? integration.allowedTools
      : Object.entries(integration.toolPolicies ?? {})
        .filter(([, policy]) => policy !== "deny")
        .map(([tool]) => tool);
    for (const tool of new Set(knownTools)) {
      if (integration.toolPolicies?.[tool] === "deny") continue;
      const emitted = `${sanitizeMcpIdentifier(integration.id)}_${sanitizeMcpIdentifier(tool)}`;
      if (emitted === name) matches.push({ serverId: integration.id, tool });
    }
  }

  if (matches.length === 1) {
    const match = matches[0]!;
    return { name: `mcp__${match.serverId}__${match.tool}`, resolution: "resolved" };
  }

  const looksLikeConfiguredMcp = integrations.some((integration) =>
    name.startsWith(`${sanitizeMcpIdentifier(integration.id)}_`),
  );
  return matches.length > 1 || looksLikeConfiguredMcp ? { name, resolution: "ambiguous" } : { name };
}

/** Parse the stable `opencode models` output: one provider/model per line. */
export function parseOpenCodeModels(stdout: string): ModelCatalog | undefined {
  const ids = [
    ...new Set(
      stdout
        .replace(ANSI_ESCAPE, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => !NON_CHAT_MODEL.test(line))
        .filter((line) => /^[^\s/]+\/\S+$/.test(line)),
    ),
  ];
  if (!ids.length) return undefined;
  return {
    default: ids[0],
    options: ids.map((id) => ({ id, label: id })),
  };
}

function discoverModels(config: AcpConfig, env: Record<string, string | undefined>, cwd: string) {
  return new Promise<ModelCatalog | undefined>((resolve, reject) => {
    execCli(config.cli, ["models"], { cwd, env, timeout: 30_000 }, (error, stdout) => {
      if (error) return reject(error);
      const models = parseOpenCodeModels(stdout);
      if (!models) return reject(new Error("opencode models returned no models"));
      resolve(models);
    });
  });
}

function parseAuthList(stdout: string): boolean | undefined {
  const clean = stdout.replace(ANSI_ESCAPE, "");
  const credentials = /\b(\d+)\s+credentials?\b/i.exec(clean)?.[1];
  const environment = /\b(\d+)\s+environment\s+variables?\b/i.exec(clean)?.[1];
  if (credentials === undefined && environment === undefined) return undefined;
  return Number(credentials ?? 0) > 0 || Number(environment ?? 0) > 0;
}

function isAuthenticated(env: Record<string, string | undefined>, cli = "opencode", cwd?: string) {
  return new Promise<boolean | undefined>((resolve) => {
    execCli(cli, ["--pure", "auth", "list"], { cwd, env, timeout: 8_000 }, (error, stdout) => {
      // An auth probe failure must not make an unknown engine selectable.
      resolve(error ? false : (parseAuthList(stdout) ?? false));
    });
  });
}

function transformEnv(env: Record<string, string | undefined>, explicitEnv: Record<string, string> = {}) {
  for (const key of XINYUN_PROVIDER_ENV) {
    if (!(key in explicitEnv)) delete env[key];
  }
}

const support: AcpSupport = {
  driverKind: "opencodeAgent",
  displayName: "OpenCode",
  models: EMPTY_MODELS,
  defaultCli: "opencode",
  nativeSource: "opencode.acp",
  loginNote: "OpenCode has no configured provider credentials — run `opencode auth login` in a terminal",
  install: {
    command: {
      darwin: "npm install -g opencode-ai",
      win32: "npm install -g opencode-ai",
      linux: "npm install -g opencode-ai",
    },
    docsUrl: "https://opencode.ai/docs/",
    signInCommand: "opencode auth login",
    needsNode: true,
  },
  spawnArgs: () => ["acp"],
  transformEnv,
  pickAuthMethod: (methods) => (methods.some((method) => method.id === "opencode-login") ? "opencode-login" : null),
  authFailure: "continue",
  isAuthenticated,
  discoverModels,
  normalizeMcpTool: normalizeOpenCodeMcpTool,
  configureSessionModel: async (request, sessionId, model) => {
    const result = await request(
      "session/set_config_option",
      { sessionId, configId: "model", value: model },
      30_000,
    );
    const options = (result as { configOptions?: unknown } | null)?.configOptions;
    const selected = Array.isArray(options)
      ? options.find((option) => (option as { id?: unknown })?.id === "model")
      : undefined;
    if ((selected as { currentValue?: unknown } | undefined)?.currentValue !== model) {
      throw new Error(`OpenCode ACP did not apply the selected model "${model}"`);
    }
  },
};

export const OpenCodeAgentDriver = createAcpDriver(support);
