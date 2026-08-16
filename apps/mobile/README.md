# XinyunOpen Bot iOS

Expo SDK 57 Development Build 客户端。完整运行、EAS、Apple 与 Secrets 说明见 `../../docs/ios-companion.md`。

```bash
pnpm install
pnpm --filter @xinyun/mobile typecheck
pnpm --filter @xinyun/mobile start
```

本目录只包含公开配置示例；设备令牌写入 iOS Keychain（`expo-secure-store`），离线快照写入 `expo-sqlite`。
