import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { DATA_DIR } from "../config.js";
const CONFIG_FILE = join(DATA_DIR, "mobile-sync.json");
export function loadDesktopSyncConfig() {
    try {
        const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
        if (!raw.gatewayUrl || !raw.workspaceId || !raw.deviceId || !raw.accessToken)
            return null;
        return raw;
    }
    catch {
        return null;
    }
}
export function saveDesktopSyncConfig(config) {
    writeFileAtomic(CONFIG_FILE, JSON.stringify(config, null, 2));
}
export async function createDesktopPairing(gatewayUrl, deviceName) {
    const normalized = gatewayUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalized))
        throw Object.assign(new Error("同步服务地址必须以 http:// 或 https:// 开头"), { status: 400 });
    const response = await fetch(`${normalized}/v1/pairings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: `workspace-${randomUUID()}`, deviceName }),
        signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok)
        throw Object.assign(new Error(body.error ?? `配对服务返回 ${response.status}`), { status: 502 });
    const config = {
        gatewayUrl: normalized,
        workspaceId: body.workspaceId,
        deviceId: body.desktopDeviceId,
        accessToken: body.desktopAccessToken,
        pairedAt: Date.now(),
    };
    saveDesktopSyncConfig(config);
    return { config, pairing: { code: body.code, expiresAt: body.expiresAt, workspaceId: body.workspaceId } };
}
export const websocketUrl = (gatewayUrl) => `${gatewayUrl.replace(/^http/i, "ws")}/v1/sync`;
