# XinyunOpen Bot iOS 伴侣

## 架构

```text
iOS Development Build
  ↕ HTTPS / WSS
Sync Gateway (Node.js 24, WebSocket, SQLite)
  ↕ PC 主动发起的出站 WebSocket
XinyunOpen Bot desktop server (仍只监听 127.0.0.1:8799)
  ↕
Claude / Codex / Grok / MCP / Cloud Box
```

手机只保存设备访问令牌。Provider API Key、CLI 登录凭据、Box Token、Apple/EAS 凭据都不会进入移动端同步快照。

## 本地启动

```powershell
cd D:\projects\OpenMausBot-ios
pnpm install --frozen-lockfile
pnpm dev:gateway   # 终端 1
pnpm dev:server    # 终端 2，仍是 127.0.0.1:8799
pnpm dev:mobile    # 终端 3，Expo Metro
```

在桌面端打开「应用设置 → iPhone 伴侣」，填入 Gateway 地址并生成 8 位配对码；在 iPhone App 输入相同地址和配对码。

> 真机不能使用 `127.0.0.1` 访问电脑上的 Gateway。开发时应使用局域网 HTTPS/WSS 地址、可信反向代理或已部署的 Gateway。

## 已实现的 MVP

- 电脑/手机一次性配对、设备访问令牌、设备撤销接口
- 机器人列表、群聊列表、一对一与群聊消息
- 流式 token、忙碌状态、停止任务
- 审批/问题卡片响应
- 未读状态、SQLite 离线缓存、自动重连、按 sequence 补同步
- Expo Push Token 注册、任务完成本地通知与 Gateway 推送分发
- 简体中文、系统深色模式、iPhone 安全区与键盘适配
- `expo-audio` 录音入口；MVP 将录音标记为语音消息文本，后续协议可增加二进制上传/STT

## 验证命令

```powershell
pnpm test
pnpm test:workspaces
pnpm test:mobile-sync:e2e
pnpm typecheck
pnpm typecheck:workspaces
pnpm build
pnpm --filter @xinyun/mobile build
pnpm dlx expo-doctor@latest apps/mobile
```

`test:mobile-sync:e2e` 会启动临时 Gateway 和临时桌面数据目录，完成：桌面创建配对 → iOS 领取 → Snapshot 补同步 → iOS `bot.update` 命令 → 桌面权威状态变化 → 手机收到 `bot.updated`。它不会读取或改写 `~/.openmausbot/config.json`。

## Apple 侧准备清单

基础开发不依赖以下项目，但真机分发/TestFlight 前需要准备：

- Apple Developer Program 账号与 Apple Team ID
- App Store Connect 对应权限
- Bundle Identifier：默认 `com.dongpen.xinyunopenbot.ios`；若 Apple 后台已占用，再更换
- 应用显示名称：`XinyunOpen Bot`
- 隐私政策 URL 与技术支持 URL
- 最终 1024×1024 App 图标、商店截图与应用说明
- Push Notifications capability、APNs Key 或 EAS Push 配置
- TestFlight 内部/外部测试人员
- 已配置的权限文案：麦克风、相机、语音识别

不得提交 Apple `.p12`、Provisioning Profile、APNs Key、Apple ID 密码、Expo Token、JWT Secret、数据库密码或 Provider API Key。

## EAS Development Build

```powershell
pnpm exec eas whoami
pnpm exec eas init --project <EAS_PROJECT_ID>
pnpm exec eas env:create --name EXPO_PUBLIC_SYNC_GATEWAY_URL --value https://sync.example.com --environment development --visibility plaintext
pnpm exec eas build --platform ios --profile development
```

Windows 只能通过 EAS 云构建 iOS；不得把本地 Expo export 当作 Xcode/真机验证。

## GitHub Secrets

无签名 iOS Simulator CI 不需要 Apple 私钥。若另建 EAS 云构建工作流，建议只在 GitHub Secrets 中配置：

- `EXPO_TOKEN`
- `EXPO_PUBLIC_EAS_PROJECT_ID`
- `EXPO_PUBLIC_SYNC_GATEWAY_URL`（不是密钥，但可按环境管理）

不要把 Apple/Expo 凭据写进 workflow YAML、`.env`、截图或构建日志。

## 部署 Gateway

```powershell
docker build -f services/sync-gateway/Dockerfile -t xinyun-sync-gateway .
docker run --rm -p 8788:8788 -v xinyun-sync:/data `
  -e SYNC_PUBLIC_URL=https://sync.example.com `
  -e SYNC_DATABASE_PATH=/data/sync-gateway.sqlite `
  xinyun-sync-gateway
```

生产环境必须在 Gateway 前终止 TLS，并让 iOS 使用 `https://` / `wss://`。PC 端始终只建立出站连接。
