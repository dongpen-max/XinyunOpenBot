export type ModelVendor =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "deepseek"
  | "zhipu"
  | "qwen"
  | "moonshot"
  | "opencode"
  | "computer"
  | "unknown";

export interface ModelVendorHint {
  modelId?: string;
  modelLabel?: string;
  displayName?: string;
  instanceId?: string;
  driverKind?: string;
}

function vendorFromText(text: string): Exclude<ModelVendor, "computer" | "unknown"> | undefined {
  const value = text.toLowerCase();
  if (/claude|anthropic/.test(value)) return "anthropic";
  if (/deepseek/.test(value)) return "deepseek";
  if (/(?:^|[\s/_.-])glm(?:$|[\s/_.-])|zhipu|thudm|智谱/.test(value)) return "zhipu";
  if (/qwen|dashscope|tongyi|通义|千问/.test(value)) return "qwen";
  if (/kimi|moonshot|月之暗面/.test(value)) return "moonshot";
  if (/gemini|google|antigravity/.test(value)) return "google";
  if (/opencode/.test(value)) return "opencode";
  if (/(?:^|[\s/_.-])grok(?:$|[\s/_.-])|(?:^|[\s/_.-])xai(?:$|[\s/_.-])|x\.ai/.test(value)) return "xai";
  if (/(?:^|[\s/_.-])gpt(?:$|[\s/_.-])|(?:^|[\s/_.-])o[1-9](?:$|[\s/_.-])|openai|chatgpt|codex/.test(value)) {
    return "openai";
  }
  return undefined;
}

function vendorFromDriver(driverKind = ""): ModelVendor {
  switch (driverKind.toLowerCase()) {
    case "codex":
    case "openai":
      return "openai";
    case "claudeagent":
    case "anthropic":
      return "anthropic";
    case "geminiagent":
    case "gemini":
    case "antigravity":
      return "google";
    case "grok":
    case "grokagent":
    case "xai":
      return "xai";
    case "deepseek":
      return "deepseek";
    case "zhipu":
    case "glm":
      return "zhipu";
    case "qwen":
    case "dashscope":
      return "qwen";
    case "kimi":
    case "kimiagent":
    case "moonshot":
      return "moonshot";
    case "opencodeagent":
    case "opencode":
      return "opencode";
    case "boxagent":
      return "computer";
    default:
      return "unknown";
  }
}

/** Resolve the model creator, not merely the transport or relay driver. */
export function inferModelVendor(hint: ModelVendorHint): ModelVendor {
  const modelVendor = vendorFromText(`${hint.modelId ?? ""} ${hint.modelLabel ?? ""}`);
  if (modelVendor) return modelVendor;

  const instanceVendor = vendorFromText(`${hint.displayName ?? ""} ${hint.instanceId ?? ""}`);
  if (instanceVendor) return instanceVendor;

  return vendorFromDriver(hint.driverKind);
}
