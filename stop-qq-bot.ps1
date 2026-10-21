# 停止 QQ 机器人桥接
$proj = $PSScriptRoot
$pidFile = Join-Path $proj 'logs\qq-bot.pid'
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old) {
    $p = Get-Process -Id $old -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $old -Force; Write-Host "已停止 PID=$old" }
    else { Write-Host '进程已不存在' }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
} else {
  Write-Host '没有运行中的实例（未找到 pid 文件）'
}
