# QQ 机器人实施计划

来源：`docs/superpowers/specs/2026-10-21-qq-bot-design.md`（已评审通过）

## 实施顺序

### 阶段 1：桥接程序（我这边可以直接做完）

1. 脚手架 `D:\dshProjects\qq-bot-bridge\`：`package.json`（依赖 `ws`）、`.gitignore`、`config.example.json`。
2. `src/deepseek.js` —— DeepSeek 流式调用（SSE 解析、超时、错误码）。
3. `src/session.js` —— 每聊天历史：追加/截断/TTL 清理/可选 JSON 持久化/串行锁。
4. `src/onebot.js` —— OneBot v11：WS 连接+重连、私聊/群@过滤、HTTP `send_msg`、超长分片。
5. `src/index.js` —— 装配三层、加载配置、限流、优雅退出。
6. `start-qq-bot.ps1` —— 后台常驻启动 + 从 `~/.dsh/.credentials.yaml` 注入 `DEEPSEEK_API_KEY`。
7. 本地单测：`deepseek.js`（真实 key 调通）、`session.js`（历史逻辑）。

### 阶段 2：QQ 协议端（需要你在本机操作 + 扫码登录）

8. 安装 NapCat（或 LLOneBot）到 QQ NT，登录你的号。
9. 配好 OneBot v11 正向 WS `ws://127.0.0.1:3001` 与 HTTP `http://127.0.0.1:3000`。
10. 填 `config.json`（`selfId`、systemPrompt 等）。

### 阶段 3：联调

11. 小号私聊验证回复 + 多轮记忆。
12. 建群验证仅 @ 回复 + 群历史共享。
13. 边界：超长分片、断线重连、DeepSeek 超时兜底。

### 阶段 4：收尾

14. 按全局工作指令把踩坑/结论沉淀到第二大脑。
