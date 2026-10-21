# QQ 机器人桥接（qq-bot-bridge）

把 DeepSeek 助手接入你自己的 QQ 号，实现**纯聊天 + 图片识别 + 多轮记忆**，支持**私聊全回 / 群聊 @ 回**，人设可自由定制。

技术栈：NapCat（OneBot v11 协议端）+ Node.js 桥接 + DeepSeek chat API（OpenAI 兼容）。

> ⚠️ **风控警告**：用个人号做机器人有被 QQ 风控/封号的风险，尤其**从云服务器（机房 IP）登录**。建议用**小号**，或就在家里电脑（住宅 IP）跑。详见文末「风控说明」。

---

## 目录

- [功能特性](#功能特性)
- [架构](#架构)
- [前置条件](#前置条件)
- [本地部署（Windows）](#本地部署windows)
- [服务器部署（Linux）](#服务器部署linux)
- [配置说明](#配置说明)
- [人设定制](#人设定制)
- [图片识别](#图片识别)
- [风控说明（重要）](#风控说明重要)
- [常见问题](#常见问题)

---

## 功能特性

- 💬 纯聊天问答（DeepSeek `deepseek-v4-pro`）
- 🖼 图片识别（视觉模型 `deepseek-v4-flash-vision-exp`，按需自动切换）
- 🧠 多轮上下文记忆（按聊天各自独立，可配置长度）
- 👥 私聊全回 / 群聊仅 @ 回
- 🎭 人设可定制（改一行配置即可）
- 🚀 跨平台：Windows 本机或 Linux 服务器都能跑

## 架构

```
你的 QQ 号
   └─ NapCat（OneBot v11 协议端，扫码登录）
        ├─ WebSocket ws://127.0.0.1:3001  ← 桥接收消息
        └─ HTTP     http://127.0.0.1:3000  ← 桥接发消息

桥接程序（Node.js，常驻）
   ├─ onebot.js    OneBot 接入（过滤/发消息/取图）
   ├─ session.js   每聊天多轮历史
   ├─ deepseek.js  DeepSeek 流式调用
   └─ index.js     装配 + 限流 + 优雅退出
```

## 前置条件

| 项 | 说明 |
|---|---|
| QQ 号 | 一个能登录的号，**建议小号** |
| DeepSeek API Key | `sk-...`，从 DeepSeek 开放平台获取 |
| Node.js | ≥ 18（跑桥接用） |
| 部署环境 | Windows 本机，或一台 Linux 服务器（Ubuntu 24.04 推荐） |

---

## 本地部署（Windows）

### 1. 安装 Node.js

到 [nodejs.org](https://nodejs.org) 下载 LTS 版安装。

### 2. 安装 NapCat（协议端）

1. 到 [NapCatQQ Releases](https://github.com/NapNeko/NapCatQQ/releases) 下载 **`NapCat.Shell.Windows.OneKey.zip`**。
2. 解压，双击 **`NapCatInstaller.exe`** 完成安装。
3. 进入生成的 `NapCat.xxx.Shell` 文件夹，双击 **`napcat.bat`** 启动。
4. 首次会弹二维码，用**手机 QQ 扫登录**。

> 备选：LLOneBot（[GitHub](https://github.com/LLOneBot/LLOneBot)）也行，同样输出 OneBot v11。

### 3. 配置 NapCat 的 OneBot 端口

1. 浏览器打开 `http://127.0.0.1:6099`，登录令牌在启动日志里（形如 `WebUi Token: xxxx`）。
2. 「网络配置」里添加两个服务端（Token 都留空）：

| 类型 | Host | 端口 | 消息格式 |
|---|---|---|---|
| WebSocket 服务端（正向） | 127.0.0.1 | **3001** | Array |
| HTTP 服务端 | 127.0.0.1 | **3000** | Array |

### 4. 配置并启动桥接

```powershell
cd qq-bot-bridge
Copy-Item config.example.json config.json   # 然后编辑 config.json

npm install --registry=https://registry.npmmirror.com   # 国内可加镜像加速
.\start-qq-bot.ps1     # 后台启动；.\stop-qq-bot.ps1 停止
```

`config.json` 里必填：`deepseek.apiKey`（或设环境变量 `DEEPSEEK_API_KEY`）、`onebot.selfId`（机器人自己的 QQ 号）。

日志在 `logs\qq-bot.log`。启动后应看到 `[onebot] 已连接 ws://127.0.0.1:3001`。

---

## 服务器部署（Linux）

以 Ubuntu 24.04 为例，模板文件在 `deploy/` 目录。

### 1. 安装 Docker

```bash
apt-get update && apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker
```

### 2. 部署 NapCat 容器

```bash
mkdir -p /www/wwwroot/napcat/{config,QQ,plugins}
cd /www/wwwroot/napcat
# 把 deploy/compose.yaml 复制到这里，改 ACCOUNT 为你的 QQ 号、WEBUI_TOKEN 为随机串
docker compose up -d
docker compose logs -f    # 看二维码 / 登录状态
```

> **国内服务器拉不动 Docker Hub** 的话：在海外 VPS 拉镜像 `docker save|gzip`，再传回国内 `docker load`。跨境传输用 aria2 多连接可提速，详见 [deploy/镜像中转.md](deploy/镜像中转.md)。

### 3. 扫码登录 + 配置 OneBot

1. 打开 `http://<服务器IP>:6099/webui?token=<WEBUI_TOKEN>`（或日志里的地址），扫二维码登录。
2. 把 `deploy/onebot11.example.json` 复制为 `config/onebot11_<你的QQ号>.json`（容器里 host 是 `0.0.0.0`）。
3. 重启容器生效：`docker compose restart napcat`。

### 4. 部署桥接 + 开机自启

```bash
mkdir -p /opt/qq-bot-bridge
# 把 src/、package.json、config.json 上传到 /opt/qq-bot-bridge
cd /opt/qq-bot-bridge
npm install --registry=https://registry.npmmirror.com

# 用 deploy/qq-bot.service 作为模板，改 DEEPSEEK_API_KEY 和路径后：
cp deploy/qq-bot.service /etc/systemd/system/qq-bot.service
systemctl daemon-reload
systemctl enable --now qq-bot
systemctl status qq-bot    # 应看到 active (running)
```

### 5. 快速登录（服务器重启免扫码）

compose 里设 `ACCOUNT=<你的QQ号>` 环境变量（**不是** `command: -q`）。首次扫码登录后 NapCat 会缓存登录态，之后重启容器自动快速登录。

---

## 配置说明

`config.json` 各字段：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `deepseek.apiKey` | 空 | DeepSeek API Key；留空则读环境变量 `DEEPSEEK_API_KEY` |
| `deepseek.baseURL` | `https://api.deepseek.com` | API 端点 |
| `deepseek.model` | `deepseek-v4-pro` | 文字模型 |
| `deepseek.visionModel` | `deepseek-v4-flash-vision-exp` | 图片时切换的视觉模型 |
| `onebot.wsUrl` | `ws://127.0.0.1:3001` | NapCat 正向 WS 地址 |
| `onebot.httpUrl` | `http://127.0.0.1:3000` | NapCat HTTP 地址 |
| `onebot.selfId` | 0 | 机器人自己的 QQ 号（群@判断用）；0 = 自动探测 |
| `chat.systemPrompt` | — | 人设提示词 |
| `chat.maxHistory` | 20 | 每聊天记住最近几条消息 |
| `chat.idleTtlMs` | 1800000 | 多久没聊就清记忆（30 分钟） |
| `chat.persist` / `persistPath` | true | 历史是否落盘、路径 |
| `rateLimit.globalPerMinute` | 20 | 全局每分钟上限（防风控） |

## 人设定制

改 `chat.systemPrompt` 即可。写清四件事：**身份 + 风格 + 语气 + 规则**。例如：

```
你是「鲸鱼娘」，一只来自深海的鲸鱼少女 AI。性格毒舌傲娇、爱吐槽、嘴硬心软。说话口语化、带点损和俏皮，偶尔用海洋梗。用中文，回复简洁有趣，毒舌要有分寸。
```

改完重启桥接生效。

## 图片识别

- 用户发图（可带文字）→ 桥接自动取图（OneBot `get_image`，回退 url 下载）→ 转 base64 → 发给视觉模型 `visionModel` → 看图回答。
- 纯文字仍走 `model`，不额外花视觉模型的成本。
- 图片只影响**当前这一轮**，不进历史（历史记一条 `[图片]` 占位），避免撑爆上下文。

## 风控说明（重要）

- QQ 对「非官方客户端 + 非住宅 IP」登录会做风控，报错 168「账号近期存在安全风险，部分功能使用受限」。
- **从云服务器（机房 IP）登录个人主号极易触发风控**，尤其短时间内反复扫码（反复重启容器 = 多次登录尝试）。
- 建议：**用不心疼的小号**跑机器人；或就在家里电脑（住宅 IP）跑，最稳。
- 一旦被风控：登录最新手机 QQ，按提示验证恢复账号。

## 常见问题

| 问题 | 排查 |
|---|---|
| 桥接报 `ECONNREFUSED` / 连不上 3001 | NapCat 没登录成功，或 OneBot 端口没配好/没重启 |
| 机器人不回消息 | 看 `logs\qq-bot.log`（或 `journalctl -u qq-bot -f`）；确认 DeepSeek key 有效 |
| 群聊不回 | 群里要 **@ 到机器人** 才回 |
| 发图没反应 | 图片 CDN 下载失败，看日志「取图失败」；个别图可能被鉴权拦 |
| 报「已登录,无法重复登录」 | 同一个号在别处（QQ 桌面版/另一台）还登录着，先退出 |

---

## License

MIT
