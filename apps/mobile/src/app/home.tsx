import { Redirect, Stack, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectionBanner } from "@/components/connection-banner";
import { usePalette } from "@/hooks/use-palette";
import { useSync } from "@/state/sync-context";

export default function HomeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { state, unpair } = useSync();
  if (state.hydrated && !state.paired) return <Redirect href="/" />;
  const open = (kind: "bot" | "group", id: string) => router.push({ pathname: "/chat/[kind]/[id]", params: { kind, id } });
  return (
    <SafeAreaView edges={["bottom"]} style={[styles.safe, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => void unpair()}><Text style={{ color: palette.danger, fontWeight: "600" }}>断开设备</Text></Pressable> }} />
      <ConnectionBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.section, { color: palette.muted }]}>机器人</Text>
        <View style={styles.list}>
          {state.bots.map((bot) => (
            <Pressable key={bot.id} onPress={() => open("bot", bot.id)} style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}>
              <View style={[styles.avatar, { backgroundColor: bot.color || palette.accent }]}><Text style={styles.avatarText}>{bot.name.slice(0, 1)}</Text></View>
              <View style={styles.cardText}><View style={styles.row}><Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>{bot.name}</Text>{bot.busy && <Text style={[styles.busy, { color: palette.accent }]}>处理中</Text>}{bot.unread && <View style={[styles.dot, { backgroundColor: palette.accent }]} />}</View><Text numberOfLines={1} style={[styles.detail, { color: palette.muted }]}>{bot.title || bot.description || "个人机器人"}</Text></View>
              <Text style={{ color: palette.muted }}>›</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.section, { color: palette.muted, marginTop: 26 }]}>群聊</Text>
        <View style={styles.list}>
          {state.groups.length === 0 && <Text style={[styles.empty, { color: palette.muted }]}>电脑端创建群聊后会自动显示在这里。</Text>}
          {state.groups.map((group) => (
            <Pressable key={group.id} onPress={() => open("group", group.id)} style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}>
              <View style={[styles.avatar, { backgroundColor: palette.elevated }]}><Text style={[styles.avatarText, { color: palette.text }]}>群</Text></View>
              <View style={styles.cardText}><View style={styles.row}><Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>{group.name}</Text>{group.busyBotId && <Text style={[styles.busy, { color: palette.accent }]}>处理中</Text>}{group.unread && <View style={[styles.dot, { backgroundColor: palette.accent }]} />}</View><Text style={[styles.detail, { color: palette.muted }]}>{group.memberIds.length} 个机器人</Text></View>
              <Text style={{ color: palette.muted }}>›</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, content: { padding: 16, paddingBottom: 40 }, section: { fontSize: 13, fontWeight: "700", letterSpacing: 0.8, marginBottom: 10 }, list: { gap: 10 }, card: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }, avatar: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" }, avatarText: { color: "#fff", fontWeight: "800", fontSize: 18 }, cardText: { flex: 1, gap: 4 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, name: { fontSize: 16, fontWeight: "700", flexShrink: 1 }, detail: { fontSize: 13 }, busy: { fontSize: 11, fontWeight: "700" }, dot: { width: 8, height: 8, borderRadius: 4 }, empty: { padding: 20, textAlign: "center", fontSize: 13 } });
