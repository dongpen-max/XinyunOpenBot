# XinyunOpen Bot 快速启动指南

## 🚀 立即开始

**双击桌面上的 XinyunOpen Bot 快捷方式** 即可启动！

---

## ⚙️ 首次配置（必读）

### 1️⃣ 编辑 API 配置

用记事本打开以下文件：

```
<项目目录>\.env.local
```

将 `your_xxxx_api_key_here` 替换为您的真实 API 密钥：

```bash
# Claude 中转站（至少配置一个）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://你的中转站地址.com/v1
```

💡 **不使用某个服务**：删除或注释掉对应的两行即可

### 2️⃣ 启动应用

双击桌面快捷方式，会自动启动三个服务：
- 后端服务器（后台）
- 前端界面（后台）
- Electron 桌面端（主窗口）

### 3️⃣ 完成引导

首次启动会出现欢迎界面：
1. 填写姓名和邮箱（可跳过）
2. 查看 AI 引擎检测结果
3. 完成！

---

## ✅ 验证配置是否成功

在欢迎界面的"您的 AI 引擎"页面，应该显示：

✅ **已配置 API 密钥 — 可以通过中转站使用**

❌ **未登录** 或 **未找到** → 需要检查配置

---

## 📖 常见问题

### ❓ 仍然显示"未登录"

1. 检查 `.env.local` 是否正确填写（没有多余空格）
2. 确保同时配置了 `API_KEY` 和 `BASE_URL`
3. 关闭所有窗口后重新启动

### ❓ Electron 下载慢或失败

脚本已自动使用国内镜像（npmmirror），通常可以成功。如果失败：
- 检查网络连接
- 或手动运行：`cd XinyunOpenBot && pnpm install --force`

### ❓ 如何停止服务

**方法 1**：任务管理器中结束所有 `node.exe` 和 `electron.exe`

**方法 2**：在 PowerShell 中运行：
```powershell
Get-Process node,electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 📚 详细文档

- **使用指南**: `./使用指南.md`
- **API 配置说明**: `./API配置说明.md`

---

## 🌐 浏览器访问

也可以直接在浏览器中使用（桌面端运行时）：

```
http://127.0.0.1:5199
```

---

## 💡 使用技巧

- **创建机器人**：点击左下角的 ➕ 按钮
- **切换模型**：点击右上角的模型名称
- **机器人的电脑**：点击右上角的 🖥️ 图标
- **管理机器人**：右键点击左侧的机器人卡片

---

**祝您使用愉快！** 🎉
