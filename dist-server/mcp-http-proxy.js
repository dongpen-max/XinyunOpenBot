import { closeRemoteMcp, requestRemoteMcp } from "./mcp-http.js";
const url = process.env.XINYUN_MCP_URL;
if (!url)
    throw new Error("XINYUN_MCP_URL is required");
const allowedToolsConfigured = process.env.XINYUN_MCP_ALLOWED_TOOLS !== undefined;
const allowedTools = new Set(JSON.parse(process.env.XINYUN_MCP_ALLOWED_TOOLS || "[]"));
const authToken = process.env.XINYUN_MCP_AUTH_TOKEN_ENV
    ? process.env[process.env.XINYUN_MCP_AUTH_TOKEN_ENV]
    : process.env.XINYUN_MCP_AUTH_TOKEN;
const server = {
    name: process.env.XINYUN_MCP_NAME || "remote-mcp",
    url,
    auth: authToken && (process.env.XINYUN_MCP_AUTH_TYPE === "bearer" || process.env.XINYUN_MCP_AUTH_TYPE === "apiKey")
        ? {
            type: process.env.XINYUN_MCP_AUTH_TYPE,
            ...(process.env.XINYUN_MCP_AUTH_HEADER ? { header: process.env.XINYUN_MCP_AUTH_HEADER } : {}),
            token: authToken,
        }
        : undefined,
};
let session = {};
const respondError = (id, message) => {
    if (id === undefined || id === null)
        return;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } })}\n`);
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line)
            continue;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            continue;
        }
        void (async () => {
            try {
                if (message.method === "tools/call" && allowedToolsConfigured) {
                    const name = message.params?.name;
                    if (typeof name !== "string" || !allowedTools.has(name))
                        throw new Error("MCP tool is not enabled for this service");
                }
                const response = await requestRemoteMcp(server, message, session);
                session = response.session;
                for (const item of response.messages) {
                    if (message.method === "tools/list" && allowedToolsConfigured && Array.isArray(item?.result?.tools)) {
                        item.result.tools = item.result.tools.filter((tool) => allowedTools.has(tool?.name));
                    }
                    process.stdout.write(`${JSON.stringify(item)}\n`);
                }
            }
            catch (error) {
                respondError(message.id, error instanceof Error ? error.message : String(error));
            }
        })();
    }
});
process.stdin.on("end", () => void closeRemoteMcp(server, session));
