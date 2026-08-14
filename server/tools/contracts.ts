/** Provider-neutral tool contract. Provider protocols (MCP, OpenAI,
 * Anthropic, Gemini, ...) translate to and from these shapes. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolImage {
  mimeType: string;
  data: string;
}

export interface ToolResult {
  text: string;
  images: ToolImage[];
  isError: boolean;
}

export interface ToolProvider {
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

