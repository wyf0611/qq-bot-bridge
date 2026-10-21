# 启动 QQ 机器人桥接（后台常驻）
$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot

# 清除可能失效的代理环境变量（Node 直连 api.deepseek.com，本机 7890 代理当前未运行）
$env:HTTP_PROXY = $null; $env:HTTPS_PROXY = $null
$env:http_proxy = $null; $env:https_proxy = $null

# 1. 从 DSH 凭据注入 DeepSeek key（仅当未设环境变量）
if (-not $env:DEEPSEEK_API_KEY) {
  $cred = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
  if (Test-Path $cred) {
    $m = Select-String -Path $cred -Pattern 'DEEPSEEK_API_KEY:\s*(\S+)' | Select-Object -First 1
    if ($m) { $env:DEEPSEEK_API_KEY = $m.Matches[0].Groups[1].Value }
  }
}
if (-not $env:DEEPSEEK_API_KEY) {
  Write-Error '未找到 DEEPSEEK_API_KEY，请确认 ~/.dsh/.credentials.yaml 或手动设置环境变量'
}

# 2. 确保 config.json 存在
if (-not (Test-Path (Join-Path $proj 'config.json'))) {
  Write-Error '缺少 config.json，请从 config.example.json 复制并填写'
}

# 3. 若已有实例在跑，先停掉
$logDir = Join-Path $proj 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$pidFile = Join-Path $logDir 'qq-bot.pid'
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old) {
    $p = Get-Process -Id $old -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $old -Force; Start-Sleep -Milliseconds 500 }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

# 4. 后台启动
$outLog = Join-Path $logDir 'qq-bot.log'
$errLog = Join-Path $logDir 'qq-bot.err.log'
$proc = Start-Process -FilePath 'node' -ArgumentList 'src/index.js' `
  -WorkingDirectory $proj `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
  -PassThru -WindowStyle Hidden
$proc.Id | Out-File -FilePath $pidFile -Encoding ascii

Write-Host "QQ 机器人已启动，PID=$($proc.Id)"
Write-Host "日志: $outLog"
