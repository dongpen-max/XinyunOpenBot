import Constants from "expo-constants";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePalette } from "@/hooks/use-palette";
import { useSync } from "@/state/sync-context";

export default function PairingScreen() {
  const palette = usePalette();
  const { state, pair } = useSync();
  const [gatewayUrl, setGatewayUrl] = useState(String(Constants.expoConfig?.extra?.defaultGatewayUrl ?? ""));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (!state.hydrated) return <View style={[styles.center, { backgroundColor: palette.background }]}><ActivityIndicator color={palette.accent} /></View>;
  if (state.paired) return <Redirect href="/home" />;

  const submit = async () => {
    setBusy(true);
    try { await pair(gatewayUrl, code); } catch {} finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
        <View style={[styles.logo, { backgroundColor: palette.accent }]}><Text style={[styles.logoText, { color: palette.accentText }]}>X</Text></View>
        <Text style={[styles.title, { color: palette.text }]}>连接你的电脑</Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>在电脑端「应用设置 → iPhone 伴侣」生成配对码，然后在这里输入。</Text>
        <View style={styles.form}>
          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" value={gatewayUrl} onChangeText={setGatewayUrl} placeholder="https://sync.example.com" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} />
          <TextInput autoCapitalize="characters" autoCorrect={false} value={code} onChangeText={(value) => setCode(value.replace(/[^a-fA-F0-9]/g, "").toUpperCase())} maxLength={8} placeholder="8 位配对码" placeholderTextColor={palette.muted} style={[styles.input, styles.code, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} />
          {state.lastError && <Text style={{ color: palette.danger, textAlign: "center" }}>{state.lastError}</Text>}
          <Pressable disabled={busy || !gatewayUrl.trim() || code.length < 6} onPress={() => void submit()} style={({ pressed }) => [styles.button, { backgroundColor: palette.accent, opacity: busy || pressed ? 0.65 : 1 }]}>
            {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={[styles.buttonText, { color: palette.accentText }]}>开始同步</Text>}
          </Pressable>
        </View>
        <Text style={[styles.privacy, { color: palette.muted }]}>模型密钥与 CLI 登录凭据不会保存到手机。</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, logo: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 22 }, logoText: { fontSize: 34, fontWeight: "800" }, title: { fontSize: 28, fontWeight: "800" }, subtitle: { fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 10, maxWidth: 340 }, form: { width: "100%", maxWidth: 420, gap: 12, marginTop: 30 }, input: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 16, fontSize: 16 }, code: { textAlign: "center", fontSize: 22, fontWeight: "700", letterSpacing: 5 }, button: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 }, buttonText: { fontSize: 16, fontWeight: "700" }, privacy: { fontSize: 12, marginTop: 24 } });
