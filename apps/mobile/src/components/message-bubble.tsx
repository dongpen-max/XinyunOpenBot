import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileMessage } from "@xinyun/contracts";
import { usePalette } from "@/hooks/use-palette";

type ApprovalCard = { requestId?: string; title?: string; subtitle?: string; options?: string[]; answered?: string; dismissed?: boolean };

export function MessageBubble({ message, threadId, onApproval }: { message: MobileMessage; threadId: string; onApproval: (payload: unknown) => void }) {
  const palette = usePalette();
  const user = message.role === "user";
  const card = message.card && typeof message.card === "object" ? message.card as ApprovalCard : null;
  if (message.kind === "screen") return null;
  return (
    <View style={[styles.row, user ? styles.userRow : styles.botRow]}>
      <View style={[styles.bubble, { backgroundColor: user ? palette.accent : palette.surface, borderColor: palette.border }]}>
        {message.from && <Text style={[styles.sender, { color: palette.accent }]}>{message.from.name}</Text>}
        {message.kind === "activity" ? <Text style={[styles.activity, { color: palette.muted }]}>{message.tool?.name ?? "正在处理"}{message.tool?.ok === false ? " · 失败" : ""}</Text> : null}
        {message.text ? <Text selectable style={[styles.text, { color: user ? palette.accentText : palette.text }]}>{message.text}</Text> : null}
        {card && (
          <View style={[styles.card, { borderColor: palette.border }]}>
            <Text style={[styles.cardTitle, { color: palette.text }]}>{card.title || "需要你的确认"}</Text>
            {card.subtitle && <Text style={[styles.cardSubtitle, { color: palette.muted }]}>{card.subtitle}</Text>}
            {card.answered ? <Text style={[styles.answered, { color: palette.accent }]}>已选择：{card.answered}</Text> : !card.dismissed && card.requestId ? (
              <View style={styles.options}>{(card.options?.length ? card.options : ["允许", "拒绝"]).map((option) => (
                <Pressable key={option} onPress={() => onApproval({ threadId, requestId: card.requestId, behavior: option, message: option })} style={({ pressed }) => [styles.option, { backgroundColor: palette.elevated, opacity: pressed ? 0.6 : 1 }]}><Text style={{ color: palette.text, fontWeight: "600" }}>{option}</Text></Pressable>
              ))}</View>
            ) : null}
          </View>
        )}
        <Text style={[styles.time, { color: user ? palette.accentText : palette.muted }]}>{new Date(message.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</Text>
      </View>
    </View>
  );
}

export function StreamingBubble({ text }: { text: string }) {
  const palette = usePalette();
  if (!text) return null;
  return <View style={[styles.row, styles.botRow]}><View style={[styles.bubble, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text selectable style={[styles.text, { color: palette.text }]}>{text}<Text style={{ color: palette.accent }}> ▍</Text></Text></View></View>;
}

const styles = StyleSheet.create({ row: { width: "100%", paddingHorizontal: 14, marginVertical: 4 }, userRow: { alignItems: "flex-end" }, botRow: { alignItems: "flex-start" }, bubble: { maxWidth: "86%", borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, paddingVertical: 10 }, sender: { fontSize: 12, fontWeight: "700", marginBottom: 5 }, text: { fontSize: 16, lineHeight: 23 }, activity: { fontSize: 13, fontStyle: "italic" }, time: { fontSize: 10, marginTop: 5, opacity: 0.7, alignSelf: "flex-end" }, card: { marginTop: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth }, cardTitle: { fontSize: 14, fontWeight: "700" }, cardSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 3 }, options: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 }, option: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }, answered: { marginTop: 8, fontSize: 13, fontWeight: "600" } });
