import * as SecureStore from "expo-secure-store";

export interface PairingCredentials {
  workspaceId: string;
  deviceId: string;
  accessToken: string;
  gatewayUrl: string;
}

const KEY = "xinyun.sync.credentials.v1";

export async function loadCredentials(): Promise<PairingCredentials | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PairingCredentials;
    return value.workspaceId && value.deviceId && value.accessToken && value.gatewayUrl ? value : null;
  } catch {
    return null;
  }
}

export const saveCredentials = (credentials: PairingCredentials) => SecureStore.setItemAsync(KEY, JSON.stringify(credentials), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
export const clearCredentials = () => SecureStore.deleteItemAsync(KEY);
