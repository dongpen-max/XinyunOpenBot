import NetInfo from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createClientMutationId, SyncClient, type SyncConnectionState } from "@xinyun/sync-client";
import { workspaceSnapshotSchema, type MobileMessage, type SyncCommand, type SyncEvent, type WorkspaceSnapshot } from "@xinyun/contracts";
import { claimPairing, registerPushToken, revokeDevice, toWebSocketUrl } from "@/lib/gateway";
import { clearCredentials, loadCredentials, saveCredentials, type PairingCredentials } from "@/lib/credentials";
import { clearCache, loadCache, saveCache } from "@/lib/database";
import type { MobileCache, MobileState } from "./types";

type Action =
  | { type: "hydrate"; cache: MobileCache | null; paired: boolean }
  | { type: "connection"; connection: SyncConnectionState }
  | { type: "network"; available: boolean }
  | { type: "event"; event: SyncEvent }
  | { type: "active"; threadId: string | null }
  | { type: "error"; message: string | null }
  | { type: "unpair" };

const initialState: MobileState = { hydrated: false, paired: false, sequence: 0, bots: [], groups: [], messagesByThread: {}, connection: "idle", networkAvailable: true, streamingByThread: {}, activeThreadId: null, lastError: null };

const upsert = <T extends { id: string }>(items: T[], item: T) => {
  const index = items.findIndex((existing) => existing.id === item.id);
  return index < 0 ? [item, ...items] : items.map((existing, i) => i === index ? { ...existing, ...item } : existing);
};

function reducer(state: MobileState, action: Action): MobileState {
  if (action.type === "hydrate") return { ...state, ...(action.cache ?? {}), hydrated: true, paired: action.paired };
  if (action.type === "connection") return { ...state, connection: action.connection };
  if (action.type === "network") return { ...state, networkAvailable: action.available };
  if (action.type === "active") return {
    ...state,
    activeThreadId: action.threadId,
    bots: state.bots.map((bot) => bot.threadId === action.threadId ? { ...bot, unread: false } : bot),
    groups: state.groups.map((group) => group.threadId === action.threadId ? { ...group, unread: false } : group),
  };
  if (action.type === "error") return { ...state, lastError: action.message };
  if (action.type === "unpair") return { ...initialState, hydrated: true };
  const event = action.event;
  if (event.sequence <= state.sequence) return state;
  if (event.type === "snapshot") {
    const snapshot = workspaceSnapshotSchema.parse(event.payload) as WorkspaceSnapshot;
    return { ...state, sequence: event.sequence, bots: snapshot.bots, groups: snapshot.groups, messagesByThread: snapshot.messagesByThread, streamingByThread: {} };
  }
  if (event.type === "bot.updated") return { ...state, sequence: event.sequence, bots: upsert(state.bots, event.payload as MobileState["bots"][number]) };
  if (event.type === "group.updated") return { ...state, sequence: event.sequence, groups: upsert(state.groups, event.payload as MobileState["groups"][number]) };
  if (event.type === "message.added" || event.type === "message.patched") {
    const { threadId, message } = event.payload as { threadId: string; message: MobileMessage };
    const current = state.messagesByThread[threadId] ?? [];
    const messages = upsert(current, message).sort((a, b) => a.at - b.at);
    const bots = state.bots.map((bot) => bot.threadId === threadId && message.role === "bot" && state.activeThreadId !== threadId ? { ...bot, unread: true } : bot);
    const groups = state.groups.map((group) => group.threadId === threadId && message.role === "bot" && state.activeThreadId !== threadId ? { ...group, unread: true } : group);
    return { ...state, sequence: event.sequence, bots, groups, messagesByThread: { ...state.messagesByThread, [threadId]: messages }, streamingByThread: { ...state.streamingByThread, [threadId]: "" } };
  }
  if (event.type === "turn.delta") {
    const { threadId, delta } = event.payload as { threadId: string; delta: string };
    return { ...state, sequence: event.sequence, streamingByThread: { ...state.streamingByThread, [threadId]: (state.streamingByThread[threadId] ?? "") + delta } };
  }
  if (event.type === "turn.completed" || event.type === "turn.interrupted") {
    const threadId = String((event.payload as { threadId?: string }).threadId ?? "");
    return { ...state, sequence: event.sequence, streamingByThread: threadId ? { ...state.streamingByThread, [threadId]: "" } : state.streamingByThread };
  }
  return { ...state, sequence: event.sequence };
}

interface SyncContextValue {
  state: MobileState;
  pair(gatewayUrl: string, code: string): Promise<void>;
  unpair(): Promise<void>;
  send(type: SyncCommand["type"], payload: unknown): void;
  setActiveThread(threadId: string | null): void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [credentials, setCredentials] = useState<PairingCredentials | null>(null);
  const clientRef = useRef<SyncClient | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    void Promise.all([loadCredentials(), loadCache()]).then(([savedCredentials, cache]) => {
      setCredentials(savedCredentials);
      dispatch({ type: "hydrate", cache, paired: Boolean(savedCredentials) });
    });
    return NetInfo.addEventListener((network) => dispatch({ type: "network", available: network.isConnected !== false }));
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    const cache: MobileCache = { sequence: state.sequence, bots: state.bots, groups: state.groups, messagesByThread: state.messagesByThread };
    void saveCache(cache);
  }, [state.hydrated, state.sequence, state.bots, state.groups, state.messagesByThread]);

  useEffect(() => {
    clientRef.current?.close();
    clientRef.current = null;
    if (!credentials) return;
    const client = new SyncClient({
      url: toWebSocketUrl(credentials.gatewayUrl),
      hello: { workspaceId: credentials.workspaceId, deviceId: credentials.deviceId, deviceType: "ios", accessToken: credentials.accessToken },
      getLastSequence: () => stateRef.current.sequence,
      onState: (connection) => dispatch({ type: "connection", connection }),
      onEvent: async (event) => {
        dispatch({ type: "event", event });
        const threadId = String((event.payload as { threadId?: string })?.threadId ?? "");
        if (event.type === "turn.completed" && stateRef.current.activeThreadId !== threadId) {
          await Notifications.scheduleNotificationAsync({ content: { title: "XinyunOpen Bot", body: "机器人任务已完成", data: { threadId } }, trigger: null });
        }
      },
    });
    clientRef.current = client;
    client.connect();
    void registerPushToken(credentials).catch(() => {});
    return () => client.close();
  }, [credentials]);

  const pair = useCallback(async (gatewayUrl: string, code: string) => {
    dispatch({ type: "error", message: null });
    try {
      const next = await claimPairing(gatewayUrl, code);
      await saveCredentials(next);
      setCredentials(next);
      dispatch({ type: "hydrate", cache: await loadCache(), paired: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "error", message });
      throw error;
    }
  }, []);

  const unpair = useCallback(async () => {
    clientRef.current?.close();
    if (credentials) await revokeDevice(credentials).catch(() => {});
    await Promise.all([clearCredentials(), clearCache()]);
    setCredentials(null);
    dispatch({ type: "unpair" });
  }, [credentials]);

  const send = useCallback((type: SyncCommand["type"], payload: unknown) => {
    clientRef.current?.sendCommand({ clientMutationId: createClientMutationId(), type, payload });
  }, []);

  const value = useMemo<SyncContextValue>(() => ({ state, pair, unpair, send, setActiveThread: (threadId) => dispatch({ type: "active", threadId }) }), [state, pair, unpair, send]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside SyncProvider");
  return value;
}
