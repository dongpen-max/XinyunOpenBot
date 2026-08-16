import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MobileMessage } from "@xinyun/contracts";
import { ConnectionBanner } from "@/components/connection-banner";
import { MessageBubble, StreamingBubble } from "@/components/message-bubble";
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import { usePalette } from "@/hooks/use-palette";
import { useSync } from "@/state/sync-context";

export default function ChatScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: "bot" | "group"; id: string }>();
  const palette = usePalette();
  const { state, send, setActiveThread } = useSync();
  const [text, setText] = useState("");
  const list = useRef<FlatList<MobileMessage>>(null);
  const entity = kind === "group" ? state.groups.find((group) => group.id === id) : state.bots.find((bot) => bot.id === id);
  const threadId = entity?.threadId ?? "";
  const messages = useMemo(() => state.messagesByThread[threadId] ?? [], [state.messagesByThread, threadId]);
  const streaming = state.streamingByThread[threadId] ?? "";
  const busy = kind === "group" ? Boolean(entity && "busyBotId" in entity && entity.busyBotId) : Boolean(entity && "busy" in entity && entity.busy);

  useEffect(() => { setActiveThread(threadId || null); return () => setActiveThread(null); }, [threadId, setActiveThread]);
  useEffect(() => { requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true })); }, [messages.length, streaming]);
  if (state.hydrated && !state.paired) return <Redirect href="/" />;
  if (!entity) return <View style={[styles.center, { backgroundColor: palette.background }]}><Text style={{ color: palette.muted }}>对话不存在或尚未同步。</Text></View>;

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    send(kind === "group" ? "group.message.send" : "message.send", kind === "group" ? { groupId: id, text: value } : { botId: id, text: value });
    setText("");
  };
  const stop = () => send(kind === "group" ? "group.turn.interrupt" : "turn.interrupt", kind === "group" ? { groupId: id } : { botId: id });

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.safe, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: entity.name }} />
      <ConnectionBanner />
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={88}>
        <FlatList ref={list} data={messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.messages} renderItem={({ item }) => <MessageBubble message={item} threadId={threadId} onApproval={(payload) => send("approval.respond", payload)} />} ListFooterComponent={<StreamingBubble text={streaming} />} />
        <View style={[styles.composer, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <VoiceRecorderButton onRecorded={(_uri, duration) => setText((current) => current || `【语音消息 ${Math.max(1, Math.round(duration / 1000))} 秒】`)} />
          <TextInput value={text} onChangeText={setText} multiline maxLength={8000} placeholder={state.connection === "online" ? "输入消息" : "离线时消息会在重连后发送"} placeholderTextColor={palette.muted} style={[styles.input, { color: palette.text, backgroundColor: palette.elevated }]} />
          {busy ? <Pressable onPress={stop} style={[styles.action, { backgroundColor: palette.danger }]}><Text style={styles.actionText}>停止</Text></Pressable> : <Pressable disabled={!text.trim()} onPress={submit} style={[styles.action, { backgroundColor: palette.accent, opacity: text.trim() ? 1 : 0.4 }]}><Text style={[styles.actionText, { color: palette.accentText }]}>发送</Text></Pressable>}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, messages: { paddingVertical: 10, flexGrow: 1, justifyContent: "flex-end" }, composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, flexDirection: "row", alignItems: "flex-end", gap: 8 }, input: { flex: 1, minHeight: 42, maxHeight: 130, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10, fontSize: 16 }, action: { minWidth: 58, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 }, actionText: { color: "white", fontSize: 13, fontWeight: "800" } });
