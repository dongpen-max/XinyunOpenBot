import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { killCliTree, spawnCli } from "../procs.ts";
import type { ToolDefinition, ToolProvider, ToolResult } from "./contracts.ts";

export interface McpStdioConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class McpStdioProvider implements ToolProvider {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stderr = "";
  private closed = false;
  private readonly signal: AbortSignal;

  constructor(config: McpStdioConfig, signal: AbortSignal) {
    this.signal = signal;
    this.child = spawnCli(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id == null) continue;
        const request = this.pending.get(Number(message.id));
        if (!request) continue;
        this.pending.delete(Number(message.id));
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk);
      if (this.stderr.length > 8192) this.stderr = this.stderr.slice(-8192);
    });
    this.child.on("error", (error) => this.failAll(new Error(`MCP process failed: ${error.message}`)));
    this.child.on("close", (code) => {
      if (!this.closed) {
        const detail = this.stderr.trim();
        this.failAll(new Error(`MCP process exited ${code}${detail ? `: ${detail.slice(-400)}` : ""}`));
      }
    });
    this.signal.addEventListener("abort", this.abort, { once: true });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openmausbot-tool-bridge", version: "1" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<ToolDefinition[]> {
    const result = await this.request("tools/list", {});
    if (!Array.isArray(result?.tools)) return [];
    return result.tools.flatMap((tool: any) => {
      if (!tool || typeof tool.name !== "string") return [];
      return [
        {
          name: tool.name,
          description: typeof tool.description === "string" ? tool.description : tool.name,
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === "object"
              ? (tool.inputSchema as Record<string, unknown>)
              : { type: "object", properties: {} },
        },
      ];
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.request("tools/call", { name, arguments: args }, 180_000);
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("\n");
    const images = content.flatMap((block: any) =>
      block?.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string"
        ? [{ data: block.data, mimeType: block.mimeType }]
        : [],
    );
    return {
      text: text || (result?.isError ? "Tool call failed without an error message." : "Tool completed."),
      images,
      isError: result?.isError === true,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.abort);
    this.failAll(new Error("MCP tool session closed"));
    try {
      this.child.stdin.end();
    } catch {}
    killCliTree(this.child);
  }

  private readonly abort = () => {
    void this.close();
  };

  private notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private request(method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
    if (this.closed || this.signal.aborted) return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

export async function connectMcpStdio(config: McpStdioConfig, signal: AbortSignal): Promise<ToolProvider> {
  const provider = new McpStdioProvider(config, signal);
  try {
    await provider.initialize();
    return provider;
  } catch (error) {
    await provider.close();
    throw error;
  }
}
