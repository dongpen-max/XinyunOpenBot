import type { ProviderErrorCode, RuntimeEvent } from "./contracts.ts";

export interface ClassifiedProviderError {
  code: ProviderErrorCode;
  recoverable: boolean;
  retryAfterMs?: number;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.name, value.code, value.status, value.message, value.stopReason].filter(Boolean).join(" ");
  }
  return String(error ?? "");
}

/** Classify provider failures without returning or persisting the raw text. */
export function classifyProviderError(error: unknown): ClassifiedProviderError {
  const text = errorText(error).toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|quota|配额|限额/.test(text)) {
    return { code: "rate_limited", recoverable: true, retryAfterMs: 60_000 };
  }
  if (/aborterror|cancel(?:led|ed|lation)?|interrupted by user|用户.*(?:取消|停止)|queue cancelled/.test(text)) {
    return { code: "cancelled", recoverable: false };
  }
  if (/timeout|timed out|deadline exceeded|etimedout|超时|未响应/.test(text)) {
    return { code: "timeout", recoverable: true, retryAfterMs: 30_000 };
  }
  if (/context.{0,24}(?:length|window|limit|overflow)|maximum context|token limit|too many tokens|上下文.{0,12}(?:溢出|超限|过长)/.test(text)) {
    return { code: "context_overflow", recoverable: true };
  }
  if (/\b(?:401|403)\b|unauthorized|forbidden|invalid api.?key|authentication|not authenticated|登录失效|认证失败|密钥无效/.test(text)) {
    return { code: "authentication", recoverable: false };
  }
  if (/missing (?:api.?key|token|configuration)|not configured|invalid config|configuration error|未配置|配置错误/.test(text)) {
    return { code: "configuration", recoverable: false };
  }
  if (/\b(?:502|503|504)\b|service unavailable|temporarily unavailable|overloaded|try again later|暂时不可用|服务繁忙/.test(text)) {
    return { code: "temporarily_unavailable", recoverable: true, retryAfterMs: 45_000 };
  }
  if (/econnreset|econnrefused|enotfound|socket hang up|connection (?:lost|closed|reset|refused)|broken pipe|network error|连接(?:中断|断开|失败)/.test(text)) {
    return { code: "connection_lost", recoverable: true, retryAfterMs: 30_000 };
  }
  if (/invalid request|bad request|tool error|task failed|不可恢复|参数错误|人工.*接管|human.*control/.test(text)) {
    return { code: "task_error", recoverable: false };
  }
  return { code: "unknown", recoverable: false };
}

export function providerErrorLabel(code: ProviderErrorCode): string {
  switch (code) {
    case "rate_limited": return "请求达到限额";
    case "timeout": return "请求超时";
    case "temporarily_unavailable": return "服务暂时不可用";
    case "connection_lost": return "连接中断";
    case "context_overflow": return "上下文过长";
    case "authentication": return "认证失败";
    case "configuration": return "配置错误";
    case "cancelled": return "用户已取消";
    case "task_error": return "任务无法继续";
    case "unknown": return "未知错误";
  }
}

/** Remove credential-shaped values while retaining enough context for UI. */
export function redactProviderSecrets(value: unknown): string {
  return String(value ?? "")
    .replace(/\bAuthorization\s*:\s*[^\r\n,;]+/gi, "Authorization: [redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, (match) => `${match.split(/\s/, 1)[0]} [redacted]`)
    .replace(
      /\b(api[_ -]?key|x-api-key|app[_ -]?secret|client[_ -]?secret|oauth[_ -]?token|access[_ -]?token|refresh[_ -]?token|box[_ -]?token|joinUrl)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .replace(/([?&](?:token|key|secret|authorization|joinUrl)=)[^&#\s]+/gi, "$1[redacted]");
}

/** Bounded fallback for setup/snapshot diagnostics that are useful in UI. */
export function redactProviderText(value: unknown): string {
  return redactProviderSecrets(value).split(/\r?\n/, 1)[0]!.slice(0, 240);
}

/**
 * Public SSE projection of a provider event. Native payloads and diagnostic
 * strings never cross the renderer boundary; conversational text remains
 * untouched because it is the actual user-visible answer.
 */
export function sanitizeRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  const { raw: _raw, ...safe } = event;
  void _raw;
  switch (safe.type) {
    case "runtime.error":
      return { ...safe, message: providerErrorLabel(classifyProviderError(safe.message).code) };
    case "session.exited":
      return safe.reason ? { ...safe, reason: redactProviderText(safe.reason) } : safe;
    case "turn.completed":
      return {
        ...safe,
        ...(safe.stopReason ? { stopReason: redactProviderText(safe.stopReason) } : {}),
        ...(safe.denials ? { denials: safe.denials.map(redactProviderText) } : {}),
      };
    case "item.started":
      return safe.title ? { ...safe, title: redactProviderText(safe.title) } : safe;
    case "request.opened":
      return { ...safe, summary: redactProviderSecrets(safe.summary).slice(0, 4_000) };
    default:
      return safe;
  }
}
