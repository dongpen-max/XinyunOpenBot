# 上游更新检查脚本 - 可独立运行或通过钩子触发
# 功能: 检测是否错过定时任务,如果错过则补跑一次

param(
    [switch]$Force  # 强制运行,忽略时间检查
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ReportDir = $ProjectRoot
$StateFile = Join-Path $ProjectRoot ".last-upstream-check"
$ScheduledHour = 9
$ScheduledMinute = 23

function Get-LastCheckTime {
    if (Test-Path $StateFile) {
        $content = Get-Content $StateFile -Raw -ErrorAction SilentlyContinue
        if ($content) {
            try {
                return [datetime]::ParseExact($content.Trim(), "yyyy-MM-dd HH:mm:ss", $null)
            } catch {
                return $null
            }
        }
    }
    return $null
}

function Set-LastCheckTime {
    param([datetime]$Time)
    $Time.ToString("yyyy-MM-dd HH:mm:ss") | Set-Content $StateFile -NoNewline
}

function Get-NextScheduledTime {
    param([datetime]$From)
    $today = $From.Date.AddHours($ScheduledHour).AddMinutes($ScheduledMinute)
    if ($From -lt $today) {
        return $today
    } else {
        return $today.AddDays(1)
    }
}

function Invoke-UpstreamCheck {
    Write-Host "🔍 正在检查上游更新..." -ForegroundColor Cyan

    Push-Location $ProjectRoot
    try {
        # 1. 获取上游最新
        git fetch origin main 2>&1 | Out-Null

        # 2. 获取版本信息
        $localCommit = (git rev-parse HEAD).Substring(0, 7)
        $upstreamCommit = (git rev-parse origin/main).Substring(0, 7)
        $localVersion = git describe --tags --abbrev=0 2>$null
        if (-not $localVersion) { $localVersion = "v0.1.7" }

        $upstreamVersion = git describe --tags --abbrev=0 origin/main 2>$null
        if (-not $upstreamVersion) { $upstreamVersion = "unknown" }

        # 3. 检查是否有新提交
        $base = git merge-base HEAD origin/main
        $commitCount = (git rev-list --count "$base..origin/main")

        if ($commitCount -eq 0) {
            Write-Host "✅ 已是最新版本 ($localVersion)" -ForegroundColor Green
            Set-LastCheckTime (Get-Date)
            return
        }

        # 4. 生成报告
        $date = Get-Date -Format "yyyy-MM-dd"
        $reportPath = Join-Path $ReportDir "上游更新报告-$date.md"

        Write-Host "📝 发现 $commitCount 个新提交,正在生成报告..." -ForegroundColor Yellow

        # 获取改动文件统计
        $stats = git diff --shortstat "$base" origin/main
        $filesChanged = if ($stats -match '(\d+) files? changed') { $matches[1] } else { "?" }
        $insertions = if ($stats -match '(\d+) insertions?') { $matches[1] } else { "0" }
        $deletions = if ($stats -match '(\d+) deletions?') { $matches[1] } else { "0" }

        # 获取冲突文件
        $localChanges = git diff --name-only "$base" HEAD
        $upstreamChanges = git diff --name-only "$base" origin/main
        $conflicts = $localChanges | Where-Object { $upstreamChanges -contains $_ }

        # 生成报告
        @"
# OpenMausBot 上游更新报告
**检查时间**: $date
**本地版本**: $localVersion ($localCommit)
**上游版本**: $upstreamVersion ($upstreamCommit)
**版本差距**: $commitCount 个 commits

---

## 📊 改动规模
- **$filesChanged 个文件改动**: +$insertions 行, -$deletions 行
"@ | Set-Content $reportPath

        if ($conflicts.Count -gt 0) {
            @"

## 🚨 冲突文件 ($($conflicts.Count) 个)

以下文件你和上游都修改了,需要手动合并:

"@ | Add-Content $reportPath
            $conflicts | ForEach-Object { "- ``$_``" } | Add-Content $reportPath
        }

        @"

---

## 📋 新增提交

``````
"@ | Add-Content $reportPath

        git log --oneline --no-merges "$base..origin/main" | Add-Content $reportPath

        @"
``````

---

**报告生成**: 自动化定时任务
**下次检查**: $(Get-Date (Get-NextScheduledTime (Get-Date)) -Format "yyyy-MM-dd HH:mm")
"@ | Add-Content $reportPath

        Write-Host "✅ 报告已生成: $reportPath" -ForegroundColor Green
        Set-LastCheckTime (Get-Date)

    } finally {
        Pop-Location
    }
}

# 主逻辑
$now = Get-Date
$lastCheck = Get-LastCheckTime

if ($Force) {
    Write-Host "🔄 强制运行检查..." -ForegroundColor Yellow
    Invoke-UpstreamCheck
    exit 0
}

if (-not $lastCheck) {
    Write-Host "📌 首次运行,执行初始检查..." -ForegroundColor Yellow
    Invoke-UpstreamCheck
    exit 0
}

# 计算应该运行的时间点
$nextScheduled = Get-NextScheduledTime $lastCheck

if ($now -gt $nextScheduled) {
    $missedHours = [math]::Round(($now - $nextScheduled).TotalHours, 1)
    Write-Host "⏰ 检测到错过定时任务 (已过 $missedHours 小时),开始补跑..." -ForegroundColor Yellow
    Invoke-UpstreamCheck
} else {
    $hoursUntil = [math]::Round(($nextScheduled - $now).TotalHours, 1)
    Write-Host "✓ 今日已检查,下次运行: $(Get-Date $nextScheduled -Format 'yyyy-MM-dd HH:mm') (还有 $hoursUntil 小时)" -ForegroundColor Green
}
