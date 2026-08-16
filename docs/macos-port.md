# XinyunOpen Bot macOS 适配与发布

## 支持范围

- macOS 13 Ventura 及以上。
- 默认发布 Apple Silicon arm64 DMG、ZIP 和 `latest-mac.yml`。
- Intel x64 由 `package:mac:x64` 与手动 CI 输入 `build_x64` 提供可选测试产物。
- Windows NSIS/ZIP、`latest.yml`、标题栏 overlay、PATHEXT/npm shim 与 `taskkill /T` 行为保持独立。

## 审计结果

### 原有 Windows 专用逻辑

- `electron/main.mjs`：AppUserModelId、隐藏标题栏 overlay 与动态颜色。
- `src/components/*`：右上角原生 caption buttons 的 144/148px 避让。
- `server/env-path.ts`：`APPDATA/npm`、WindowsApps Codex 规避、PATHEXT、`.cmd` shim 与 node shebang 解析。
- `server/procs.ts`：`windowsHide`、`taskkill /T`、Windows 进程树回收。
- `server/index.ts`：`APPDATA` 配置根目录。
- `electron-builder.yml` / `package-win.yml`：NSIS、x64 ZIP、`latest.yml` 与独立 Windows runner。

这些分支没有被 macOS 实现替换或删除。

### 原有 Darwin 分支

- hiddenInset/traffic-light 窗口、Dock reopen、Finder 启动日志目录。
- 麦克风与屏幕权限 IPC、Swift Speech helper 源码。
- `/opt/homebrew/bin`、`/usr/local/bin` 与登录 shell PATH 探测。
- DMG/ZIP、hardened runtime、entitlements、`latest-mac.yml` 发布源。
- CUA embedded/standalone 连接框架。

### 已补缺口

- Speech helper 改为带独立 Info.plist 的后台 `.app` bundle，开发构建使用 ad-hoc 签名，安装包作为 nested code 重新签名。
- Speech recognizer 使用用户首选语言，回退 `zh-CN`/`en-US`，支持增量结果、静音 endpoint、finish/stop marker、10 分钟保护超时和异常 reason。
- packaged CUA driver 与 arm64/x64 原生 SDK 被 staging 到 `Resources`，不依赖 ASAR 内的 `node_modules`。
- 新增纯 capability 检测；local computer 只在 Darwin 且 CUA 连接实际 ready 时标记可用，不按 provider 名称硬编码。
- 新增单实例、第二次启动聚焦、非 Darwin 权限 guard、CUA cleanup 超时、Speech/helper/server 退出回收。
- CLI 搜索新增 `PNPM_HOME`、`~/Library/pnpm`、npm prefix、Homebrew Apple Silicon/Intel、路径空格与 POSIX 可执行位校验。
- macOS packaged build 仅在 Developer ID 签名时启用自动更新；unsigned/ad-hoc 测试包显示明确停用状态。Windows 更新路径不变。
- 新增 macOS arm64 打包/DMG 安装/HTTP 健康检查/退出回收 CI；Intel x64 为可选 workflow_dispatch job。

## 本地开发验证

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm build:speech
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac:arm64
node scripts/verify-mac-artifacts.mjs
```

对 unsigned 产物做本机 ad-hoc 签名：

```bash
codesign --force --deep --sign - --options runtime \
  --entitlements build/entitlements.mac.plist \
  "release/mac-arm64/XinyunOpen Bot.app"
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/XinyunOpen Bot.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/XinyunOpen Bot.app" || true
```

ad-hoc 签名用于本机结构和权限调试，不会通过 Gatekeeper 的公开分发评估，且应用内自动更新保持停用。

## 正式签名与公证

GitHub Secrets：

- `MACOS_CERTIFICATE`：Developer ID Application `.p12` 的 base64。
- `MACOS_CERTIFICATE_PASSWORD`：`.p12` 密码。
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：`notarytool` 凭据。

`scripts/notarize.cjs` 在 electron-builder `afterSign` 阶段执行：先严格验证签名，再使用 `ditto` 创建提交 ZIP，运行 `xcrun notarytool submit --wait`，最后 staple/validate `.app`；随后生成的 DMG 和自动更新 ZIP 都包含已 staple 的应用。

发布前复核：

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/XinyunOpen Bot.app"
xcrun stapler validate "release/mac-arm64/XinyunOpen Bot.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/XinyunOpen Bot.app"
spctl --assess --type open --context context:primary-signature --verbose=4 release/*.dmg
shasum -a 256 release/*.dmg release/*.zip release/latest-mac.yml
```

## macOS CI 验证边界

CI 会验证：test/typecheck/build、Swift helper、DMG/ZIP/`latest-mac.yml`、权限 plist、helper/CUA 可执行资源、从 DMG 复制安装、应用启动、`127.0.0.1:8799`、`/api/health`、`/api/instances` 和退出后的端口回收。

真实麦克风输入、Speech TCC 人工授权、第三方 STT/TTS 凭据、实际扬声器听感、Accessibility/Screen Recording 人工批准仍需在真实用户会话中手工验证；CI 不伪造这些权限或密钥。
