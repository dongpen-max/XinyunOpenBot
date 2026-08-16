import { StyleSheet, Text, View } from "react-native";
import { usePalette } from "@/hooks/use-palette";
import { useSync } from "@/state/sync-context";

export function ConnectionBanner() {
  const palette = usePalette();
  const { state } = useSync();
  if (state.connection === "online" && state.networkAvailable) return null;
  const label = !state.networkAvailable ? "当前无网络，正在使用离线缓存" : state.connection === "connecting" ? "正在连接电脑…" : "连接已断开，正在自动重连";
  return <View style={[styles.banner, { backgroundColor: palette.elevated }]}><Text style={[styles.text, { color: palette.muted }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({ banner: { paddingHorizontal: 14, paddingVertical: 8, alignItems: "center" }, text: { fontSize: 12, fontWeight: "600" } });
