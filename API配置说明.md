# XinyunOpen Bot API 中转站配置指南

XinyunOpen Bot 已支持通过 API 中转站使用 Claude、OpenAI/Codex 和 xAI/Grok，无需登录本地 CLI。

## 快速配置

### 1. 编辑环境变量文件

打开 `<项目目录>\.env.local` 文件，填写您的中转站信息：

```bash
# Claude API 中转站配置
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://your-claude-proxy.com/v1

# OpenAI/Codex API 中转站配置
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
OPENAI_BASE_URL=https://your-openai-proxy.com/v1

# xAI/Grok API 中转站配置
XAI_API_KEY=xai-xxxxxxxxxxxxx
XAI_BASE_URL=https://your-xai-proxy.com/v1
```

### 2. 配置说明

- **API_KEY**: 您的中转站提供的 API 密钥
- **BASE_URL**: 中转站的基础 URL（必须以 `/v1` 结尾）
- 如果不使用某个服务，可以删除或注释掉对应的两行配置

### 3. 认证逻辑

修改后的驱动遵循以下规则：

#### Claude
- **有 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`**: 使用中转站，显示"已配置 API 密钥"
- **仅本地登录** (`~/.claude/.credentials.json`): 使用官方订阅
- **两者都无**: 显示"未登录，请运行 /login"

#### OpenAI/Codex
- **有 `OPENAI_BASE_URL` + `OPENAI_API_KEY`**: 使用中转站
- **两者都无**: CLI 自动使用 ChatGPT 登录

#### xAI/Grok
- **有 `XAI_BASE_URL` + `XAI_API_KEY`**: 使用中转站
- **本地登录** (`~/.grok/auth.json`): 使用官方订阅
- **两者都无**: 显示"未登录"

## 常见中转站示例

### 国内常见中转站格式

```bash
# 示例 1: 通用格式
ANTHROPIC_BASE_URL=https://api.example.com/v1
ANTHROPIC_API_KEY=sk-xxxxxxxx

# 示例 2: 带路径的中转站
OPENAI_BASE_URL=https://api.example.com/proxy/v1
OPENAI_API_KEY=sk-xxxxxxxx
```

### 官方 API 格式（无中转）

```bash
# Claude 官方
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_API_KEY=sk-ant-xxxxx

# OpenAI 官方
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxxxx

# xAI 官方
XAI_BASE_URL=https://api.x.ai/v1
XAI_API_KEY=xai-xxxxx
```

## 启动方式

配置完成后，双击桌面上的 **XinyunOpen Bot** 快捷方式即可启动。

或者在命令行运行：

```bash
<项目目录>\start-all.bat
```

## 验证配置

启动后，在欢迎界面的"您的 AI 引擎"页面，会显示：

- ✅ **已配置 API 密钥 — 可以通过中转站使用** （配置成功）
- ⚠️ **未找到** 或 **未登录** （需要配置或登录）

## API 模型使用云端计算机

使用 OpenAI-compatible `/chat/completions` 协议的中转实例会自动获得统一工具桥。只要具体模型支持 function calling 和图片输入，它就可以使用：

- `screenshot`、`click`、`type_text`、`press_key`、`scroll`
- `computer_batch`、`computer_exec`、`open_url`

工具执行仍复用 XinyunOpen Bot 的 MCP computer provider；模型协议和云端 Box 实现相互独立，因此同一中转站中的 GPT、Claude、Grok、Qwen、DeepSeek 等模型不需要各写一套电脑控制代码。

如果某个兼容接口只支持聊天、不支持 function calling，可在对应实例中关闭工具：

```json
{
  "instances": {
    "chatOnlyRelay": {
      "driver": "grok",
      "config": {
        "url": "https://api.example.com/v1",
        "apiKeyEnv": "CHAT_ONLY_KEY",
        "computerTools": false
      }
    }
  }
}
```

## 故障排查

### 问题 1: 仍然显示"未登录"

**原因**: `.env.local` 文件未生效

**解决**: 
1. 确认文件路径正确：`<项目目录>\.env.local`
2. 重启所有服务（关闭 Electron 窗口和后台进程）
3. 重新运行启动脚本

### 问题 2: API 调用失败

**原因**: BASE_URL 或 API_KEY 配置错误

**解决**:
1. 检查 BASE_URL 是否以 `/v1` 结尾
2. 检查 API_KEY 是否正确（无多余空格）
3. 确认中转站可访问

### 问题 3: Electron 下载失败

**原因**: 网络问题

**解决**: 启动脚本已自动使用国内镜像（npmmirror），如果仍失败：

```bash
cd XinyunOpenBot
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
pnpm install --force
```

## 技术细节

驱动修改位置：
- `server/drivers/claude.ts:307-310, 442-446` - Claude 驱动
- `server/drivers/codex.ts:90-96, 366-370` - Codex 驱动
- `server/drivers/acp/grok.ts:35-43` - Grok ACP 驱动
- `server/drivers/grok.ts` - OpenAI-compatible API 驱动与工具桥入口
- `server/tools/` - Provider-neutral 工具协议、MCP stdio 适配和 function-calling 循环

这些修改确保：
- 只有同时配置了 `BASE_URL` 和 `API_KEY` 时才转发密钥
- 避免订阅用户误用 API 被计费
- 保持与官方 CLI 登录的兼容性
