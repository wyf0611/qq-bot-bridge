import fs from 'node:fs';
import { DeepSeekClient } from '../src/deepseek.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY');
  process.exit(1);
}

const client = new DeepSeekClient({
  apiKey,
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash-vision-exp',
  timeoutMs: 60000,
});

const imagePath = process.argv[2] || 'D:/dshProjects/test-image.jpg';
const buf = fs.readFileSync(imagePath);
const b64 = buf.toString('base64');

try {
  const reply = await client.chat(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: '用一句话描述这张图片，中文' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
    { model: 'deepseek-v4-flash-vision-exp' }
  );
  console.log('VISION_OK:', reply);
} catch (e) {
  console.error('VISION_FAIL:', e.message);
  process.exit(1);
}
