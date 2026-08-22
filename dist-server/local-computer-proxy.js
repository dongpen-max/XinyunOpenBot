var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
// local-computer-proxy — an MCP stdio bridge for the Windows Cua SDK.
//
// The upstream Cua npm package deliberately ships an SDK, not the
// `cua-driver` command-line binary.  The old integration therefore only
// worked on macOS, where an externally installed daemon could be found.  On
// Windows this process talks to the native SDK directly, so selecting
// "此 Windows 电脑" always gives the model real local computer tools.
//
// stdout is reserved for JSON-RPC.  Do not add logging here.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// In a packaged Windows app the SDK is shipped beside the app under
// Resources/cua-sdk; in development Node resolves it from node_modules.
// Dynamic import keeps both layouts on the exact same MCP implementation.
const sdkRoot = process.env.OMB_CUA_SDK_ROOT;
const sdkEntry = sdkRoot
    ? pathToFileURL(join(sdkRoot, "packages", "@trycua", "cua-driver", "dist", "index.js")).href
    : "@trycua/cua-driver";
const { CuaDriver } = await import(__rewriteRelativeImportExtension(sdkEntry));
const driver = CuaDriver.create(undefined);
let toolList = null;
// A client can close stdin/stdout immediately after a one-shot probe. stdout
// errors are transport teardown, not an MCP bridge failure; swallowing EPIPE
// keeps Electron from emitting an unhandled error while the process exits.
process.stdout.on("error", (error) => {
    if (error.code === "EPIPE")
        process.exit(0);
    process.exitCode = 1;
});
const send = (message) => {
    if (!process.stdout.destroyed)
        process.stdout.write(`${JSON.stringify(message)}\n`);
};
function result(id, value) {
    send({ jsonrpc: "2.0", id, result: value });
}
function failure(id, message) {
    result(id, { content: [{ type: "text", text: message }], isError: true });
}
async function tools() {
    if (toolList)
        return toolList;
    const payload = JSON.parse(await driver.listToolsJson());
    toolList = Array.isArray(payload.tools)
        ? payload.tools.filter((tool) => Boolean(tool && typeof tool.name === "string"))
        : [];
    return toolList;
}
function mcpTool(tool) {
    return {
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema ?? tool.input_schema ?? { type: "object", properties: {} },
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
    };
}
function contentFrom(value) {
    const content = [];
    if (value.text)
        content.push({ type: "text", text: value.text });
    if (value.structuredJson) {
        // Keep the SDK's machine-readable state available to every model while
        // retaining its concise human summary above.
        content.push({ type: "text", text: `Structured state:\n${value.structuredJson}` });
    }
    for (const image of value.images ?? []) {
        if (image.dataBase64) {
            content.push({ type: "image", data: image.dataBase64, mimeType: image.mimeType || "image/png" });
        }
    }
    return content.length ? content : [{ type: "text", text: "Local computer tool completed." }];
}
async function handle(message) {
    if (message.method === "initialize") {
        return result(message.id, {
            protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "xinyunopen-local-computer", version: "1" },
        });
    }
    if (message.method === "tools/list")
        return result(message.id, { tools: (await tools()).map(mcpTool) });
    if (message.method === "tools/call") {
        const name = message.params?.name;
        if (typeof name !== "string")
            return failure(message.id, "local computer tool name is required");
        try {
            const value = (await driver.callTool(name, JSON.stringify(message.params?.arguments ?? {})));
            return result(message.id, { content: contentFrom(value), ...(value.isError ? { isError: true } : {}) });
        }
        catch (error) {
            return failure(message.id, `local computer tool failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (String(message.method ?? "").startsWith("notifications/"))
        return;
    if (message.id != null)
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } });
}
let buffer = "";
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
            try {
                void handle(JSON.parse(line));
            }
            catch {
                // An MCP client that sends malformed input must not crash the agent
                // process that owns this bridge.
            }
        }
        newline = buffer.indexOf("\n");
    }
});
process.stdin.on("end", () => {
    driver.uniffiDestroy?.();
    process.exit(0);
});
