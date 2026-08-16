import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import type { PairingClaimResponse } from "@xinyun/contracts";
import type { PairingCredentials } from "./credentials";

export async function claimPairing(gatewayUrl: string, code: string): Promise<PairingCredentials> {
  const base = gatewayUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("同步服务地址必须以 http:// 或 https:// 开头");
  const response = await fetch(`${base}/v1/pairings/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim(), deviceName: Device.deviceName || "iPhone" }),
  });
  const body = await response.json() as PairingClaimResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "配对失败");
  return { workspaceId: body.workspaceId, deviceId: body.deviceId, accessToken: body.accessToken, gatewayUrl: base };
}

export async function registerPushToken(credentials: PairingCredentials): Promise<void> {
  if (!Device.isDevice) return;
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId || /^0+$/.test(projectId.replaceAll("-", ""))) return;
  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await fetch(`${credentials.gatewayUrl}/v1/devices/push-token`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credentials.accessToken}`, "x-device-id": credentials.deviceId },
    body: JSON.stringify({ workspaceId: credentials.workspaceId, pushToken }),
  });
}

export async function revokeDevice(credentials: PairingCredentials): Promise<void> {
  await fetch(`${credentials.gatewayUrl}/v1/devices/${encodeURIComponent(credentials.deviceId)}?workspaceId=${encodeURIComponent(credentials.workspaceId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${credentials.accessToken}`, "x-device-id": credentials.deviceId },
  }).then((response) => { if (!response.ok && response.status !== 404) throw new Error(`device revoke returned ${response.status}`); });
}

export const toWebSocketUrl = (gatewayUrl: string) => `${gatewayUrl.replace(/^http/i, "ws")}/v1/sync`;
