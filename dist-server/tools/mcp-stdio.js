import { killCliTree, spawnCli } from "../procs.js";
class McpStdioProvider {
    child;
    pending = new Map();
    nextId = 1;
    stderr = "";
    closed = false;
    signal;
    constructor(config, signal) {
        this.signal = signal;
        this.child = spawnCli(config.command, config.args, {
            env: { ...process.env, ...config.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        let buffer = "";
        this.child.stdout.on("data", (chunk) => {
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (!line.trim())
                    continue;
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (message.id == null)
                    continue;
                const request = this.pending.get(Number(message.id));
                if (!request)
                    continue;
                this.pending.delete(Number(message.id));
                clearTimeout(request.timer);
                if (message.error)
                    request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
                else
                    request.resolve(message.result);
            }
        });
        this.child.stderr.on("data", (chunk) => {
            this.stderr += String(chunk);
            if (this.stderr.length > 8192)
                this.stderr = this.stderr.slice(-8192);
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
    async initialize() {
        await this.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "openmausbot-tool-bridge", version: "1" },
        });
        this.notify("notifications/initialized", {});
    }
    async listTools() {
        const result = await this.request("tools/list", {});
        if (!Array.isArray(result?.tools))
            return [];
        return result.tools.flatMap((tool) => {
            if (!tool || typeof tool.name !== "string")
                return [];
            return [
                {
                    name: tool.name,
                    description: typeof tool.description === "string" ? tool.description : tool.name,
                    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
                        ? tool.inputSchema
                        : { type: "object", properties: {} },
                },
            ];
        });
    }
    async callTool(name, args) {
        const result = await this.request("tools/call", { name, arguments: args }, 180_000);
        const content = Array.isArray(result?.content) ? result.content : [];
        const text = content
            .filter((block) => block?.type === "text" && typeof block.text === "string")
            .map((block) => block.text)
            .join("\n");
        const images = content.flatMap((block) => block?.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string"
            ? [{ data: block.data, mimeType: block.mimeType }]
            : []);
        return {
            text: text || (result?.isError ? "Tool call failed without an error message." : "Tool completed."),
            images,
            isError: result?.isError === true,
        };
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.signal.removeEventListener("abort", this.abort);
        this.failAll(new Error("MCP tool session closed"));
        try {
            this.child.stdin.end();
        }
        catch { }
        killCliTree(this.child);
    }
    abort = () => {
        void this.close();
    };
    notify(method, params) {
        if (this.closed)
            return;
        this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }
    request(method, params, timeoutMs = 30_000) {
        if (this.closed || this.signal.aborted)
            return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
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
            }
            catch (error) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    failAll(error) {
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        this.pending.clear();
    }
}
export async function connectMcpStdio(config, signal) {
    const provider = new McpStdioProvider(config, signal);
    try {
        await provider.initialize();
        return provider;
    }
    catch (error) {
        await provider.close();
        throw error;
    }
}
export async function connectMcpStdioMany(configs, signal) {
    if (!configs.length)
        return null;
    const providers = [];
    try {
        for (const config of configs)
            providers.push(await connectMcpStdio(config, signal));
    }
    catch (error) {
        await Promise.allSettled(providers.map((provider) => provider.close()));
        throw error;
    }
    let routes = null;
    const listTools = async () => {
        const nextRoutes = new Map();
        const definitions = [];
        for (const provider of providers) {
            for (const definition of await provider.listTools()) {
                if (nextRoutes.has(definition.name)) {
                    throw new Error(`duplicate MCP tool name: ${definition.name}`);
                }
                nextRoutes.set(definition.name, provider);
                definitions.push(definition);
            }
        }
        routes = nextRoutes;
        return definitions;
    };
    return {
        listTools,
        async callTool(name, args) {
            if (!routes)
                await listTools();
            const provider = routes?.get(name);
            if (!provider)
                throw new Error(`unknown MCP tool: ${name}`);
            return provider.callTool(name, args);
        },
        async close() {
            await Promise.allSettled(providers.map((provider) => provider.close()));
        },
    };
}
