export type ModelVendor =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "deepseek"
  | "zhipu"
  | "qwen"
  | "moonshot"
  | "mistral"
  | "meta"
  | "microsoft"
  | "cohere"
  | "minimax"
  | "baichuan"
  | "internlm"
  | "tencent"
  | "stepfun"
  | "yi"
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
  if (/mistral|mixtral/.test(value)) return "mistral";
  if (/llama|meta/.test(value)) return "meta";
  if (/phi|microsoft/.test(value)) return "microsoft";
  if (/cohere|command-r/.test(value)) return "cohere";
  if (/minimax|abab/.test(value)) return "minimax";
  if (/baichuan|百川/.test(value)) return "baichuan";
  if (/internlm|书生/.test(value)) return "internlm";
  if (/hunyuan|腾讯|tencent/.test(value)) return "tencent";
  if (/stepfun|阶跃星辰/.test(value)) return "stepfun";
  if (/(?:^|[\s/_.-])yi(?:$|[\s/_.-])|零一万物/.test(value)) return "yi";
  if (/gemini|google|antigravity/.test(value)) return "google";
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
    case "mistral":
      return "mistral";
    case "meta":
    case "llama":
      return "meta";
    case "microsoft":
    case "phi":
      return "microsoft";
    case "cohere":
      return "cohere";
    case "minimax":
      return "minimax";
    case "baichuan":
      return "baichuan";
    case "internlm":
      return "internlm";
    case "tencent":
    case "hunyuan":
      return "tencent";
    case "stepfun":
      return "stepfun";
    case "yi":
      return "yi";
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
