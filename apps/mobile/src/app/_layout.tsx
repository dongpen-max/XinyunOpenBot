import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useColorScheme } from "react-native";
import { SyncProvider } from "@/state/sync-context";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SyncProvider>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerBackTitle: "返回", headerShadowVisible: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="home" options={{ title: "XinyunOpen Bot" }} />
          <Stack.Screen name="chat/[kind]/[id]" options={{ title: "对话" }} />
        </Stack>
      </ThemeProvider>
    </SyncProvider>
  );
}
