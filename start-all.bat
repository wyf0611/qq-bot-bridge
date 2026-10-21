@echo off
chcp 65001 >nul
title 启动 QQ 机器人

echo [1/2] 启动 NapCat 协议端...
echo        若弹出二维码，请用手机 QQ 扫码登录
start "NapCat" /D "C:\Users\wyf\Desktop\NapCat.Shell.Windows.OneKey\NapCat.52230.Shell" napcat.bat

echo 等待 NapCat 启动 15 秒...
timeout /t 15 /nobreak >nul

echo [2/2] 启动桥接程序...
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\dshProjects\qq-bot-bridge\start-qq-bot.ps1"

echo.
echo 完成。桥接已在后台运行，日志：D:\dshProjects\qq-bot-bridge\logs\qq-bot.log
echo 提示：NapCat 那个黑色窗口要保持开着，别关。
pause
