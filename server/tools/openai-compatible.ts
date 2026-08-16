import { newId } from "../contracts.ts";
import type { ReasoningEffort } from "../contracts.ts";
import type { ToolProvider, ToolResult } from "./contracts.ts";

export type OpenAIContent =
  | string
  | null
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
    >;

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type OpenAIMessage =
  | { role: "system" | "user"; content: OpenAIContent }
  | { role: "assistant"; content: OpenAIContent; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenAIToolLoopResult {
  text: string;
  usage: { input: number; output: number } | null;
}

interface ToolCallDelta {
  id: string;
  name: string;
  arguments: string;
}

interface CompletionRound {
  text: string;
  toolCalls: OpenAIToolCall[];
  usage: { input: number; output: number } | null;
  finishReason: string | null;
}

export interface OpenAIToolLoopOptions {
  model: string;
  messages: OpenAIMessage[];
  reasoningEffort?: ReasoningEffort;
  signal: AbortSignal;
  toolProvider?: ToolProvider | null;
  maxRounds?: number;
  request(body: Record<string, unknown>, signal: AbortSignal): Promise<Response>;
  onRequest?(body: Record<string, unknown>): void;
  onRound?(round: CompletionRound): void;
  onTextDelta?(delta: string): void;
  onToolStarted?(call: OpenAIToolCall): void;
  onToolCompleted?(call: OpenAIToolCall, result: ToolResult): void;
}

async function streamRound(
  body: Record<string, unknown>,
  opts: OpenAIToolLoopOptions,
): Promise<CompletionRound> {
  opts.onRequest?.(body);
  const response = await opts.request(body, opts.signal);
  if (!response.body) throw new Error("provider returned an empty streaming response");

  let text = "";
  let usage: CompletionRound["usage"] = null;
  let finishReason: string | null = null;
  const calls = new Map<number, ToolCallDelta>();
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      opts.onTextDelta?.(delta.content);
    }
    for (const piece of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = Number.isInteger(piece?.index) ? piece.index : 0;
      const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (typeof piece.id === "string") current.id = piece.id;
      if (typeof piece.function?.name === "string") current.name += piece.function.name;
      if (typeof piece.function?.arguments === "string") current.arguments += piece.function.arguments;
      calls.set(index, current);
    }
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    if (chunk.usage) {
      usage = {
        input: Number(chunk.usage.prompt_tokens) || 0,
        output: Number(chunk.usage.completion_tokens) || 0,
      };
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      consume(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer.trim());

  const round = {
    text,
    toolCalls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        id: call.id || newId(),
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments || "{}" },
      }))
      .filter((call) => call.function.name),
    usage,
    finishReason,
  };
  opts.onRound?.(round);
  return round;
}

function invalidArguments(call: OpenAIToolCall, error: unknown): ToolResult {
  return {
    text: `Invalid JSON arguments for ${call.function.name}: ${error instanceof Error ? error.message : String(error)}`,
    images: [],
    isError: true,
  };
}

export async function runOpenAICompatibleToolLoop(opts: OpenAIToolLoopOptions): Promise<OpenAIToolLoopResult> {
  const messages = [...opts.messages];
  const definitions = opts.toolProvider ? await opts.toolProvider.listTools() : [];
  const tools = definitions.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  const maxRounds = opts.maxRounds ?? 24;
  let fullText = "";
  let totalInput = 0;
  let totalOutput = 0;
  let sawUsage = false;

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex++) {
    const body: Record<string, unknown> = { model: opts.model, messages, stream: true };
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const round = await streamRound(body, opts);
    fullText += round.text;
    if (round.usage) {
      sawUsage = true;
      totalInput += round.usage.input;
      totalOutput += round.usage.output;
    }
    if (!round.toolCalls.length) {
      return {
        text: fullText,
        usage: sawUsage ? { input: totalInput, output: totalOutput } : null,
      };
    }
    if (!opts.toolProvider) throw new Error("provider requested tools, but no tool provider is mounted");

    messages.push({ role: "assistant", content: round.text || null, tool_calls: round.toolCalls });
    const imageBlocks: Array<{ label: string; mimeType: string; data: string }> = [];
    for (const call of round.toolCalls) {
      opts.onToolStarted?.(call);
      let result: ToolResult;
      let args: Record<string, unknown>;
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("arguments must be an object");
        args = parsed as Record<string, unknown>;
      } catch (error) {
        result = invalidArguments(call, error);
        opts.onToolCompleted?.(call, result);
        messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
        continue;
      }
      try {
        result = await opts.toolProvider.callTool(call.function.name, args);
      } catch (error) {
        result = {
          text: `Tool ${call.function.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          images: [],
          isError: true,
        };
      }
      opts.onToolCompleted?.(call, result);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
      for (const image of result.images) imageBlocks.push({ label: call.function.name, ...image });
    }
    if (imageBlocks.length) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `Computer images returned by the preceding tool calls (${imageBlocks.map((image) => image.label).join(", ")}). Use them as the current screen state.`,
          },
          ...imageBlocks.map((image) => ({
            type: "image_url" as const,
            image_url: { url: `data:${image.mimeType};base64,${image.data}`, detail: "high" as const },
          })),
        ],
      });
    }
  }
  throw new Error(`tool loop exceeded ${maxRounds} provider rounds`);
}
