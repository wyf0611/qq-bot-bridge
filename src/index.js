// 入口：装配 deepseek / session / onebot 三层，加载配置，限流，优雅退出
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeepSeekClient } from './deepseek.js';
import { SessionStore } from './session.js';
import { OneBotClient } from './onebot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class RateLimiter {
  constructor(perMinute) {
    this.perMinute = perMinute;
    this.hits = [];
  }

  async wait() {
    if (!this.perMinute) return;
    const now = Date.now();
    const windowMs = 60_000;
    this.hits = this.hits.filter((t) => now - t < windowMs);
    if (this.hits.length >= this.perMinute) {
      const waitMs = this.hits[0] + windowMs - now;
      await new Promise((r) => setTimeout(r, waitMs));
      this.hits = this.hits.filter((t) => Date.now() - t < windowMs);
    }
    this.hits.push(Date.now());
  }
}

async function loadConfig() {
  const configPath = process.env.QQ_BOT_CONFIG || path.join(__dirname, '..', 'config.json');
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (e) {
    console.error('无法读取 config.json。请从 config.example.json 复制并填写。路径:', configPath);
    process.exit(1);
  }
  if (!config.deepseek?.apiKey) {
    config.deepseek.apiKey = process.env.DEEPSEEK_API_KEY || '';
  }
  return config;
}

async function main() {
  const config = await loadConfig();
  if (!config.deepseek.apiKey) {
    console.error('未配置 DeepSeek API key（config.json 的 deepseek.apiKey 或环境变量 DEEPSEEK_API_KEY）');
    process.exit(1);
  }

  const deepseek = new DeepSeekClient(config.deepseek);
  const sessions = new SessionStore({ ...config.chat });
  await sessions.load();
  const limiter = new RateLimiter(config.rateLimit?.globalPerMinute ?? 0);

  const onebot = new OneBotClient(config.onebot, {
    async onMessage({ chatId, type, text, images, userId, groupId }) {
      if (!text && (!images || images.length === 0)) {
        await onebot.sendText(type, '（我只会文字聊天哦）', userId, groupId).catch(() => {});
        return;
      }
      await sessions.runExclusive(chatId, async () => {
        const history = sessions.get(chatId);
        const hasImages = images && images.length > 0;

        // 历史里图片用占位符，真实图片只进当前这一轮
        const historyRecord = { role: 'user', content: text + (hasImages ? ' [图片]' : '') };
        let userMessage;
        if (hasImages) {
          const content = [];
          if (text) content.push({ type: 'text', text });
          for (const img of images) {
            content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
          }
          userMessage = { role: 'user', content };
        } else {
          userMessage = { role: 'user', content: text };
        }

        history.push(historyRecord);

        await limiter.wait();

        let reply;
        try {
          const model = hasImages
            ? (config.deepseek.visionModel || 'deepseek-v4-flash-vision-exp')
            : config.deepseek.model;
          const msgs = [
            { role: 'system', content: config.chat.systemPrompt },
            ...history.slice(0, -1),
            userMessage,
          ];
          reply = await deepseek.chat(msgs, { model });
        } catch (e) {
          console.error('[bot] DeepSeek 调用失败:', e.message);
          reply = '我这边出错了，稍后再试。';
        }

        sessions.push(chatId, 'assistant', reply);
        try {
          await onebot.sendText(type, reply, userId, groupId);
        } catch (e) {
          console.error('[bot] 发送失败:', e.message);
        }
      });
    },
  });

  onebot.start();
  console.log('[bot] QQ 机器人桥接已启动');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[bot] 正在退出...');
    onebot.stop();
    await sessions.save();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[bot] 启动失败:', e);
  process.exit(1);
});
