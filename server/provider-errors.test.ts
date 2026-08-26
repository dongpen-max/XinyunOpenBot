import { describe, expect, it } from "vitest";

import { classifyProviderError, redactProviderText, sanitizeRuntimeEvent } from "./provider-errors.ts";

describe("provider error classification", () => {
  it.each([
    ["HTTP 429 quota exceeded", "rate_limited", true],
    ["request timed out after 30s", "timeout", true],
    ["503 service temporarily unavailable", "temporarily_unavailable", true],
    ["ECONNRESET socket hang up", "connection_lost", true],
    ["maximum context length exceeded", "context_overflow", true],
    ["401 invalid api key", "authentication", false],
    ["missing API key configuration", "configuration", false],
    ["AbortError cancelled by user", "cancelled", false],
    ["invalid request parameter", "task_error", false],
    ["电脑正在由人工接管", "task_error", false],
  ] as const)("classifies %s", (message, code, recoverable) => {
    expect(classifyProviderError(message)).toMatchObject({ code, recoverable });
  });
});

describe("provider error redaction", () => {
  it("removes credentials and stack lines from public diagnostics", () => {
    const safe = redactProviderText("Authorization: Bearer secret-value api_key=sk-test joinUrl=https://box.example/join\n at internal stack");
    expect(safe).not.toMatch(/secret-value|sk-test|box\.example|internal stack/);
    expect(safe).toContain("[redacted]");
  });

  it("removes native payloads and credentials from public runtime events", () => {
    const event = sanitizeRuntimeEvent({
      eventId: "event-1",
      provider: "fixture",
      providerInstanceId: "fixture-1",
      threadId: "thread-1",
      createdAt: "2026-08-26T00:00:00.000Z",
      type: "runtime.error",
      message: "HTTP 429 Authorization: Bearer secret-value",
      raw: { source: "fixture", payload: { authorization: "Bearer secret-value", joinUrl: "https://example.invalid/join" } },
    });
    expect(event).toMatchObject({ type: "runtime.error", message: "请求达到限额" });
    expect(event).not.toHaveProperty("raw");
    expect(JSON.stringify(event)).not.toMatch(/secret-value|joinUrl|authorization/i);
  });

  it("redacts credential-shaped tool summaries without altering assistant output", () => {
    const base = {
      eventId: "event-2",
      provider: "fixture",
      threadId: "thread-1",
      createdAt: "2026-08-26T00:00:00.000Z",
    } as const;
    const request = sanitizeRuntimeEvent({
      ...base,
      type: "request.opened",
      requestType: "permission",
      tool: "curl",
      summary: "x-api-key: secret-key access_token=secret-token",
    });
    expect(request.type === "request.opened" ? request.summary : "").not.toMatch(/secret-key|secret-token/);

    const answer = sanitizeRuntimeEvent({ ...base, type: "item.completed", itemType: "assistant_text", text: "Bearer is ordinary answer text" });
    expect(answer.type === "item.completed" && answer.itemType === "assistant_text" ? answer.text : "").toBe("Bearer is ordinary answer text");
  });
});
