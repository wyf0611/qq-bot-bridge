import { DeepSeekClient } from '../src/deepseek.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY');
  process.exit(1);
}
const client = new DeepSeekClient({
  apiKey,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  timeoutMs: 60000,
});
try {
  const reply = await client.chat([{ role: 'user', content: '用一句话介绍你自己，中文' }]);
  console.log('REPLY_OK:', reply);
} catch (e) {
  console.error('REPLY_FAIL:', e.message);
  process.exit(1);
}
