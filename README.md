# qq-bot-bridge

把 DeepSeek 助手接入你自己的 QQ 号，实现「纯聊天 + 多轮记忆 + 私聊全回 / 群聊 @ 回」。

设计文档见 `docs/superpowers/specs/2026-10-21-qq-bot-design.md`。

## 架构

```
你的 QQ 号（QQ NT 客户端）
   └─ NapCat / LLOneBot（OneBot v11 协议端）
        ├─ WebSocket ws://127.0.0.1:3001  ← 本桥接收事件
        └─ HTTP API  http://127.0.0.1:3000 ← 本桥接发消息
本桥接（Node.js 常驻）
   ├─ onebot.js   OneBot v11 接入（过滤/发送）
   ├─ session.js  每聊天多轮历史
   └─ deepseek.js DeepSeek 流式调用
```

## 前置条件

- Node.js ≥ 18（本机已装 v24）
- 本机安装 QQ NT 桌面版并登录目标号
- NapCat 或 LLOneBot（二选一，见下）

## 安装协议端（二选一）

### 方式一：LLOneBot（Windows 一键装，推荐入门）

1. 用 LLOneBot 官方「一键安装器」装到 QQ NT。
2. 打开设置 → 网络配置：启用「正向 WebSocket」，监听 `127.0.0.1:3001`；启用「HTTP」，监听 `127.0.0.1:3000`。

### 方式二：NapCat

1. 按 NapCat 官方文档装 NapCat.Framework 到 QQ NT，登录目标号。
2. 配置 OneBot v11 服务：正向 WebSocket `ws://127.0.0.1:3001` + HTTP `127.0.0.1:3000`。

> 两者都输出 OneBot v11 协议，本桥接不关心具体用哪个。以官方当前文档为准。

## 配置

```powershell
Copy-Item config.example.json config.json
```

编辑 `config.json`：

- `deepseek.apiKey`：留空即可，启动脚本会自动从 `~/.dsh/.credentials.yaml` 读 `DEEPSEEK_API_KEY` 注入；也可直接填。
- `onebot.selfId`：填机器人自己的 QQ 号（群@ 判断用）；填 0 会自动探测。
- `chat.systemPrompt`：人设，可自定义。

## 运行

```powershell
# 启动（后台常驻）
.\start-qq-bot.ps1

# 停止
.\stop-qq-bot.ps1

# 前台调试（直接看日志）
$env:DEEPSEEK_API_KEY = (Select-String "$env:USERPROFILE\.dsh\.credentials.yaml" 'DEEPSEEK_API_KEY:\s*(\S+)').Matches[0].Groups[1].Value
node src/index.js
```

日志在 `logs\qq-bot.log`。

## 测试

```powershell
node test/session.test.js     # 历史截断逻辑
# DeepSeek 调用：
$env:DEEPSEEK_API_KEY = (Select-String "$env:USERPROFILE\.dsh\.credentials.yaml" 'DEEPSEEK_API_KEY:\s*(\S+)').Matches[0].Groups[1].Value
node test/deepseek.test.js
```
