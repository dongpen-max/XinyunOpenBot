import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "XinyunOpen Bot",
  slug: "xinyunopen-bot-ios",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "xinyunopenbot",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.dongpen.xinyunopenbot.ios",
    supportsTablet: false,
    icon: "./assets/expo.icon",
    infoPlist: {
      NSMicrophoneUsageDescription: "用于向 XinyunOpen Bot 发送语音消息。",
      NSSpeechRecognitionUsageDescription: "用于将语音消息转成文字后发送给机器人。",
      NSCameraUsageDescription: "用于扫描电脑端显示的配对码和添加图片。",
    },
  },
  plugins: [
    "expo-router",
    "expo-asset",
    "expo-sqlite",
    ["expo-secure-store", { configureAndroidBackup: true, faceIDPermission: "允许使用 Face ID 保护设备配对凭据。" }],
    ["expo-audio", { microphonePermission: "用于向 XinyunOpen Bot 发送语音消息。" }],
    ["expo-camera", { cameraPermission: "用于扫描电脑端显示的配对码和添加图片。", microphonePermission: false }],
    ["expo-notifications", { defaultChannel: "tasks" }],
    ["expo-splash-screen", { backgroundColor: "#090A09", image: "./assets/images/splash-icon.png", imageWidth: 76 }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined },
    defaultGatewayUrl: process.env.EXPO_PUBLIC_SYNC_GATEWAY_URL || "",
  },
};

export default config;
