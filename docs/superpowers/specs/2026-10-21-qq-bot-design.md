# QQ 聊天机器人设计（把「我」接入 QQ）

- 日期：2026-10-21
- 状态：已评审通过（待实施）
- 技术路线：方案 A —— 轻量桥接 + NapCat/LLOneBot + 直接调 DeepSeek 聊天 API

## 1. 目标与非目标

### 目标

把 DeepSeek 助手以「纯聊天问答」的形式接入用户自己的 QQ 号，用户可以在 QQ 里像聊天一样对话：

- 私聊：机器人对每条消息都回复。
- 群聊：仅当消息 @ 到机器人本人时才回复。
- 多轮上下文记忆：每个聊天（私聊会话 / 群）各自维护独立的历史，能接着聊、能引用之前的话。

### 非目标（本期不做）

- 不开放工具能力（读写文件、跑命令、联网、第二大脑笔记等）——用户已明确「纯聊天问答」。
- 不做群聊全回（刷屏/封号风险）。
- 不做多账号、不做官方 QQ 开放平台 Bot。
- 不做图片/语音等富媒体收发（首期仅文本；NapCat 若收到图片/其他类型，桥接层返回提示或忽略）。

## 2. 需求要点（已与用户确认）

| 维度 | 决策 |
|---|---|
| QQ 登录方式 | 用户自己的 QQ 号当机器人（self-bot，有封号风险，用户已知晓） |
| 能力范围 | 纯聊天问答（无工具） |
| 触发范围 | 私聊全回 + 群聊仅 @ 触发 |
| 对话记忆 | 多轮上下文（按聊天各自独立） |
| 技术路线 | 方案 A：轻量桥接 + 直接调 DeepSeek chat API |
| 模型 | `deepseek-v4-pro`（复用 DSH 现有配置与 `DEEPSEEK_API_KEY`） |

## 3. 总体架构

```
用户的 QQ 号（QQ NT 桌面客户端，Windows 本机）
   └─ NapCat（OneBot v11 协议端，登录该号）
        ├─ WebSocket ws://127.0.0.1:3001   ← 桥接程序连它收消息事件
        └─ HTTP API  http://127.0.0.1:3000 ← 桥接程序调它发消息

桥接程序 qq-bot-bridge（Node.js，常驻后台进程）
   ├─ OneBot 事件层（onebot.js）：连接 WS、过滤私聊/群@、发消息
   ├─ 会话层（session.js）：每个 chatId 维护多轮历史
   └─ LLM 层（deepseek.js）：调 DeepSeek chat completions（流式 SSE）
```

### 协议端选型

- 首选 **NapCat**（活跃维护、文档好、OneBot v11 支持完善）。
- 备选 **LLOneBot**（Windows 一键安装更省事，同样输出 OneBot v11）。
- 两者都需要本机安装 QQ NT 桌面版并登录目标号。实现时以当前官方安装文档为准二选一。
- OneBot v11 通信：桥接程序作为 WebSocket 客户端连 NapCat 正向 WS 收事件；通过 HTTP API `send_msg` 发消息（也可走同一 WS 的 action 帧，实现时择一，优先 HTTP 以便独立调试）。

## 4. 组件划分

### 4.1 `onebot.js` —— OneBot 接入层

职责：与 NapCat 建立/维持连接，把 QQ 消息转成内部事件，把回复发回 QQ。

- 连接 `ws://127.0.0.1:3001`，断线用指数退避自动重连（如 1s/2s/4s…封顶 60s）。
- 处理 `message` 事件（`message_type = private | group`）。
- 过滤规则：
  - `private`：全部回复。
  - `group`：仅当 `message` 含 `@机器人自己`（按 `self_id` 判断，支持 CQ code `[CQ:at,qq=<self_id>]`）时回复。
  - 自己发出的消息（`user_id == self_id`）不回复，避免回环。
  - 非文本消息（图片、语音、表情等）首期回「（我只会文字聊天哦）」或忽略。
- 发消息：POST `http://127.0.0.1:3000/send_msg`，私聊 `{message_type:"private", user_id}`，群聊 `{message_type:"group", group_id}`。
- 输出长回复分片：QQ 单条消息长度上限约 4500 字符，超出按段拆分多次 `send_msg`。

### 4.2 `session.js` —— 会话层

职责：维护每个聊天的多轮上下文。

- `Map<chatId, Message[]>`，`chatId` 规则：私聊 `private:<user_id>`，群聊 `group:<group_id>`（群聊历史全群共享一份，不按成员区分）。
- 每条消息存 `{role: "user"|"assistant", content: string}`。
- 历史上限（默认 20 条）自动截断，超限丢弃最旧。
- 空闲超时清理（默认 30 分钟无活动即清理该会话）。
- 持久化：可选，把 Map 序列化存 `data/sessions.json`，启动时加载、变更时异步落盘（防抖），重启不丢近期记忆。
- 串行化：同一 chatId 的消息按到达顺序排队处理（避免并发导致历史错乱），不同 chatId 可并行。

### 4.3 `deepseek.js` —— LLM 层

职责：调 DeepSeek chat completions 生成回复。

- `POST https://api.deepseek.com/chat/completions`（baseURL 可配置，默认 `https://api.deepseek.com`）。
- 请求头 `Authorization: Bearer <DEEPSEEK_API_KEY>`。
- 请求体：`model: "deepseek-v4-pro"`、`messages: [{role:"system",content:<人设>}, ...history]`、`stream: true`。
- 解析 SSE，拼接 `choices[].delta.content`，得到完整回复文本。
- 超时（如 120s）与空回复处理：抛出给上层，由 onebot 层回兜底文案。

### 4.4 `config.json` —— 配置

```jsonc
{
  "deepseek": {
    "apiKey": "",                       // 可选：直接填 key；留空则回退读环境变量 DEEPSEEK_API_KEY
    "baseURL": "https://api.deepseek.com",
    "model": "deepseek-v4-pro",
    "timeoutMs": 120000
  },
  "onebot": {
    "wsUrl": "ws://127.0.0.1:3001",
    "httpUrl": "http://127.0.0.1:3000",
    "selfId": 0                        // 机器人自己的 QQ 号，群@ 判断用；0 表示自动探测
  },
  "chat": {
    "systemPrompt": "你是 DeepSeek 助手，通过 QQ 与用户聊天。回复简洁友好，用中文，像朋友一样自然。",
    "maxHistory": 20,
    "idleTtlMs": 1800000
  },
  "rateLimit": {
    "globalPerMinute": 20,
    "perChatConcurrency": 1
  }
}
```

API key 来源（按优先级）：① `config.json` 的 `deepseek.apiKey`（非空时使用）；② 环境变量 `DEEPSEEK_API_KEY`；③ 启动脚本从 DSH 现有凭据 `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY` 读入并注入环境变量。key 不硬编码进源码、不入库；`config.json` 加入 `.gitignore`。

## 5. 数据流

1. 用户私聊 / 群里 @ 机器人 → QQ → NapCat → WS `message` 事件。
2. `onebot.js` 判断是否回应（私聊 always；群聊必须 @ 到 `self_id`；排除自己发的消息）。
3. 取 `chatId` 对应历史（`session.js`）→ 追加新 user 消息。
4. `deepseek.js` 以 `[system, ...历史]` 调 DeepSeek（流式）→ 得到完整 assistant 文本。
5. 回复追加进历史 → `onebot.js` 经 HTTP `send_msg` 发回（私聊/群聊参数不同），超长分片。

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| WS 断线 | 指数退避重连，重连后继续收事件 |
| DeepSeek 非 2xx / 网络错误 / 超时 / 空回复 | 回「我这边出错了，稍后再试。」；日志记录 code/原因 |
| 历史超限 | 截断最旧消息 |
| 空闲会话 | 超时清理 |
| 发送失败（send_msg 非 0 返回码） | 日志记录，重试一次 |
| 非文本消息 | 回「（我只会文字聊天哦）」或忽略 |

## 7. 安全 / 风险

- self-bot 有封号风险：仅私聊 + 群@，不做群全回；加限流（全局每分钟上限、每聊天串行）。
- API key 不硬编码、不入库：环境变量优先，`config.json` 进 `.gitignore`。
- 不在日志中打印完整消息内容中的敏感信息（key 永不打印）。

## 8. 目录结构（计划）

```
D:\dshProjects\qq-bot-bridge\
├─ package.json
├─ config.json          （+ config.example.json；config.json 进 .gitignore）
├─ src\
│  ├─ index.js          （入口：装配三层 + 启动）
│  ├─ onebot.js
│  ├─ session.js
│  └─ deepseek.js
├─ data\sessions.json   （运行时生成，进 .gitignore）
├─ start-qq-bot.ps1     （后台常驻启动脚本）
└─ docs\superpowers\specs\2026-10-21-qq-bot-design.md
```

## 9. 测试

1. 单元：`deepseek.js` 用真实 key 调一次，确认能流式返回中文文本。
2. 单元：`session.js` 历史追加/截断/清理。
3. 联调：起 NapCat，用另一个号（小号）私聊验证回复 + 多轮记忆。
4. 联调：建群，验证仅 @ 时回复、群历史共享。
5. 边界：超长回复分片、断线重连、DeepSeek 超时兜底。

## 10. 已知限制

- 纯文本，不支持图片/语音等富媒体收发（首期）。
- 群聊历史全群共享，不区分具体成员。
- 记忆在内存（可选持久化），机器人进程重启后仅保留已落盘的历史。
