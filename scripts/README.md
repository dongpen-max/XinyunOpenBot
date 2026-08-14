# 上游更新检查使用说明

## 功能

自动检测 OpenMausBot 上游仓库更新，错过定时任务时自动补跑。

## 运行方式

### 1. 自动运行（推荐）
- **定时任务**: 每天 9:23 AM 自动检查
- **会话启动**: 每次打开 Claude Code 会话时自动检测是否错过，如果错过则补跑
- **状态文件**: `.last-upstream-check` 记录上次检查时间

### 2. 手动运行

```powershell
# 检查是否需要补跑（智能判断）
.\scripts\upstream-check.ps1

# 强制立即检查（忽略时间）
.\scripts\upstream-check.ps1 -Force
```

## 生成报告

报告保存在项目根目录：`上游更新报告-YYYY-MM-DD.md`

包含内容：
- 版本差距统计
- 冲突文件列表（你和上游都改了的文件）
- 新增提交清单

## 文件说明

- `scripts/upstream-check.ps1` - 主检查脚本
- `.claude/hooks/session-started.ps1` - 会话启动钩子
- `.last-upstream-check` - 上次检查时间戳（自动生成，不要手动编辑）

## 工作原理

1. 脚本检查 `.last-upstream-check` 记录的上次运行时间
2. 如果距离上次运行已超过一个周期（24小时），且当前时间已过 9:23 AM，则自动补跑
3. 运行后更新时间戳，避免重复执行
4. 每次打开会话时，钩子会静默检查一次（后台运行，不阻塞）

## 注意事项

- 首次运行会立即执行一次检查
- 钩子在后台运行，不会延迟会话启动
- 状态文件 `.last-upstream-check` 已加入 `.gitignore`
