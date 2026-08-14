# 会话启动钩子 - 检查是否需要补跑上游更新任务
# 每次打开 Claude Code 会话时自动执行

$ErrorActionPreference = "SilentlyContinue"

# 静默运行检查脚本（后台执行，不阻塞会话启动）
$scriptPath = Join-Path $PSScriptRoot "..\..\scripts\upstream-check.ps1"
if (Test-Path $scriptPath) {
    Start-Job -ScriptBlock {
        param($Path)
        & $Path
    } -ArgumentList $scriptPath | Out-Null
}
