# XinyunOpen Bot

**面向中国用户的开源 Grok Bot 替代方案，默认使用简体中文。**

XinyunOpen Bot 是一个基于 Electron、React 和 TypeScript 的桌面 AI 机器人管理工具。你可以像聊天联系人一样创建多个机器人，为每个机器人选择不同模型、独立任务和云端电脑，并在一个桌面应用里统一管理 Claude、Codex、GPT、Grok、Gemini 以及 OpenAI 兼容中转站模型。

> 本项目基于 [OpenMausBot](https://github.com/milind-soni/OpenMausBot) 开源项目开发，保留 MIT 许可证与原项目版权声明。XinyunOpen Bot 是独立社区项目，与 Grok Bot、xAI、OpenAI、Anthropic 或 Google 没有官方隶属关系。

## 下载

### Windows 10 / 11（x64）

- [下载最新版安装程序](https://github.com/dongpen-max/xinyunopenbot-releases/releases/latest/download/XinyunOpen-Bot-setup.exe)
- [查看全部版本](https://github.com/dongpen-max/xinyunopenbot-releases/releases)

安装包为按用户安装，不要求管理员权限。目前尚未购买 Windows 代码签名证书，首次运行时 Windows SmartScreen 可能显示“未知发布者”，可以选择“更多信息 → 仍要运行”。

### macOS

macOS 版本仍在整理发布流程。当前可从源码运行；后续安装包会发布到同一 Releases 页面。

## 为什么做 XinyunOpen Bot

Grok Bot 的“把 AI 当作聊天联系人管理”的产品形态很好用，但中国用户通常还需要：

- 默认简体中文界面；
- 支持国内可访问的 OpenAI 兼容中转站；
- 同时接入 GPT、Claude、Grok、Gemini、Qwen、DeepSeek 等模型；
- API 地址和模型目录可以自行配置；
- Windows 安装包和更适合国内网络的构建方式；
- 密钥、聊天记录和机器人状态保存在本机。

XinyunOpen Bot 保留多机器人聊天体验，并强化国内中转站、多模型和云电脑工具支持。

## 主要功能

- **多机器人管理**：每个机器人拥有独立名称、角色、模型、任务和对话历史。
- **多模型接入**：支持 Claude CLI、Codex CLI、Grok CLI、Gemini/Antigravity、xAI API 和 OpenAI-compatible API。
- **API 中转站**：支持自定义 Base URL、API Key，并可自动读取 `/v1/models` 模型列表。
- **默认简体中文**：首次启动、设置、聊天、错误提示和模型配置均以中文显示。
- **云端电脑**：机器人可以使用 Box 云桌面执行浏览器、Shell、截图、点击和输入操作。
- **本机电脑控制**：在支持的平台上可通过 CUA integration 操作本机桌面。
- **聊天房间**：多个机器人可以加入同一个房间，通过 @mention 协作。
- **对话分支**：编辑历史消息后生成新的对话分支。
- **语音聊天**：Windows、macOS 和 Linux 桌面端支持麦克风转写、回复朗读及一对一半双工连续通话。
- **应用内更新**：从公开 Releases 仓库读取更新元数据并下载安装。
- **本地数据**：配置、聊天记录和事件日志默认保存在 `~/.openmausbot/`。

## 快速开始

### 使用安装包

1. 从 Releases 下载 `XinyunOpen-Bot-setup.exe`。
2. 运行安装程序并选择安装目录。
3. 打开 **XinyunOpen Bot**。
4. 在“应用设置”中配置模型或中转站。
5. 新建机器人并选择模型即可开始使用。

### 从源码运行

需要：

- Node.js 24 或更高版本
- pnpm 10
- Windows、macOS 或 Linux 开发环境

```bash
git clone https://github.com/dongpen-max/XinyunOpenBot.git
cd XinyunOpenBot
pnpm install
```

开发模式：

```bash
pnpm dev
pnpm dev:server
```

桌面模式：

```bash
pnpm dev:desktop
```

Windows 打包：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
pnpm package:win
```

## 中转站配置

在应用设置中填写：

- API Key
- Base URL，例如 `https://example.com/v1`
- 模型列表，或点击“获取模型”自动发现

当前支持 Anthropic、OpenAI、xAI 三类配置入口。OpenAI-compatible driver 可供 GPT、Grok、Claude、Qwen、DeepSeek 等兼容模型使用；对于支持 Anthropic 原生 `/messages` 的 Claude 中转站，也可以使用 Claude Agent driver。

## 语音聊天配置

在“应用设置 → 语音聊天”中分别配置兼容 OpenAI Audio API 的 STT 与 TTS 服务：

- STT Base URL、API Key、模型（默认 `whisper-1`）和语言（默认 `zh`）；
- TTS Base URL、API Key、模型（默认 `tts-1`）和声音（默认 `alloy`）；
- 可选“自动朗读新回复”。

应用会调用 `${Base URL}/audio/transcriptions` 识别录音，并调用 `${Base URL}/audio/speech` 合成回复。API Key 仅由本机 Harness 读取，不会回传到前端。配置完成后，可使用输入框麦克风按钮、机器人回复旁的朗读按钮，或聊天标题栏的电话按钮。

详细说明：

- [API 配置说明](./API配置说明.md)
- [使用指南](./使用指南.md)

## 数据与隐私

默认本地数据目录：

```text
~/.openmausbot/
```

其中可能包含：

- `config.json`：应用配置和 API Key
- 机器人及任务状态
- 对话记录
- provider 事件日志

这些文件不会被提交到 Git。请勿把 `.env.local`、个人 `config.json` 或日志中的密钥上传到公开仓库。

## 技术栈

- Electron
- React 19
- TypeScript
- Vite
- Tailwind CSS
- Node.js HTTP Server
- Vitest
- electron-builder

## 开发检查

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 项目结构

```text
src/                 React 前端
server/              Node.js 后端与 provider drivers
electron/            Electron 主进程、preload 和自动更新
build/               应用图标与打包资源
scripts/             构建、检查和发布脚本
docs/                技术文档和截图
```

## 路线图

- 云端 Box 主实例与任务租约策略
- 更多国内模型预设
- macOS 安装包与签名发布
- Windows 代码签名
- 中转站健康检查和模型自动刷新
- 模型切换与 provider 状态界面优化

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请运行：

```bash
pnpm test
pnpm typecheck
```

## 许可证

[MIT License](./LICENSE)

Copyright © 2026 Milind Soni、OpenMausBot contributors 与 XinyunOpen Bot contributors。
