// OneBot v11 接入层：正向 WebSocket 收事件、HTTP API 发消息、私聊/群@ 过滤、超长分片、图片提取
import WebSocket from 'ws';
import fs from 'node:fs/promises';

export class OneBotClient {
  constructor(config, handlers) {
    this.wsUrl = config.wsUrl;
    this.httpUrl = config.httpUrl;
    this.selfId = config.selfId || 0;
    this.handlers = handlers; // { onMessage({ chatId, type, text, images, userId, groupId }) }
    this.ws = null;
    this.reconnectDelay = 1000;
    this.closed = false;
  }

  start() {
    this.#connect();
  }

  #connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1000;
      console.log('[onebot] 已连接', this.wsUrl);
    });
    ws.on('message', (data) => this.#onRaw(data));
    ws.on('close', () => {
      if (this.closed) return;
      console.log(`[onebot] 连接断开，${this.reconnectDelay}ms 后重连`);
      this.#scheduleReconnect();
    });
    ws.on('error', (e) => console.error('[onebot] ws 错误:', e.message));
  }

  #onRaw(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.post_type === 'message') {
      this.#onMessage(msg).catch((e) => console.error('[onebot] 消息处理异常:', e.message));
    } else if (msg.post_type === 'meta_event' && msg.meta_event_type === 'lifecycle') {
      if (msg.self_id && !this.selfId) {
        this.selfId = msg.self_id;
        console.log('[onebot] self_id 探测为', msg.self_id);
      }
    }
  }

  async #onMessage(event) {
    const userId = event.user_id;
    if (this.selfId && userId === this.selfId) return; // 不回自己，避免回环

    const text = this.#extractText(event.message);
    const images = await this.#extractImages(event.message);

    if (event.message_type === 'private') {
      this.handlers.onMessage({
        chatId: `private:${userId}`,
        type: 'private',
        text,
        images,
        userId,
        groupId: null,
      });
      return;
    }

    if (event.message_type === 'group') {
      if (!this.#isAtSelf(event.message)) return; // 群聊仅 @ 触发
      this.handlers.onMessage({
        chatId: `group:${event.group_id}`,
        type: 'group',
        text,
        images,
        userId,
        groupId: event.group_id,
      });
    }
  }

  #isAtSelf(message) {
    if (!this.selfId) return false;
    const selfId = String(this.selfId);
    if (Array.isArray(message)) {
      return message.some((seg) => seg.type === 'at' && String(seg.data?.qq) === selfId);
    }
    return String(message).includes(`[CQ:at,qq=${selfId}]`);
  }

  #extractText(message) {
    if (typeof message === 'string') return message.trim();
    if (Array.isArray(message)) {
      return message
        .filter((seg) => seg.type === 'text')
        .map((seg) => seg.data?.text ?? '')
        .join('')
        .trim();
    }
    return '';
  }

  // 提取图片段，返回 [{ mime, base64 }]
  async #extractImages(message) {
    if (!Array.isArray(message)) return [];
    const segs = message.filter((s) => s.type === 'image');
    if (segs.length === 0) return [];
    const images = [];
    for (const seg of segs) {
      try {
        const img = await this.#fetchImage(seg.data?.file, seg.data?.url);
        if (img) images.push(img);
      } catch (e) {
        console.error('[onebot] 取图失败:', e.message);
      }
    }
    return images;
  }

  async #fetchImage(file, url) {
    // 1) 优先 get_image API
    if (file) {
      try {
        const res = await fetch(this.httpUrl.replace(/\/+$/, '') + '/get_image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file }),
        });
        const data = (await res.json().catch(() => ({})))?.data;
        if (data?.file) {
          if (typeof data.file === 'string' && data.file.startsWith('base64://')) {
            return this.#imageFromBase64(data.file.slice('base64://'.length));
          }
          if (typeof data.file === 'string' && !/^https?:\/\//.test(data.file)) {
            const buf = await fs.readFile(data.file);
            return this.#imageFromBuffer(buf);
          }
        }
        if (data?.url) return await this.#downloadImage(data.url);
      } catch (e) {
        console.error('[onebot] get_image 失败，改用 url:', e.message);
      }
    }
    // 2) 回退：直接下载 url
    if (url) return await this.#downloadImage(url);
    return null;
  }

  async #downloadImage(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`下载图片失败 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return this.#imageFromBuffer(buf);
  }

  #imageFromBase64(b64) {
    return this.#imageFromBuffer(Buffer.from(b64, 'base64'));
  }

  #imageFromBuffer(buf) {
    return { mime: this.#sniffMime(buf), base64: buf.toString('base64') };
  }

  #sniffMime(buf) {
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
    return 'image/jpeg';
  }

  async sendText(type, text, userId, groupId) {
    const parts = this.#split(text, 1500); // 1500 字内，规避 QQ 单条字节上限
    for (const part of parts) {
      await this.#sendOne(type, part, userId, groupId);
    }
  }

  #split(text, size) {
    const chars = Array.from(text); // 按码点切，避免拆散 emoji 代理对
    if (chars.length <= size) return [text];
    const parts = [];
    for (let i = 0; i < chars.length; i += size) {
      parts.push(chars.slice(i, i + size).join(''));
    }
    return parts;
  }

  async #sendOne(type, text, userId, groupId) {
    const body =
      type === 'private'
        ? { message_type: 'private', user_id: userId, message: text }
        : { message_type: 'group', group_id: groupId, message: text };

    const res = await fetch(this.httpUrl.replace(/\/+$/, '') + '/send_msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.retcode !== 0 && data.status !== 'ok') {
      throw new Error(`send_msg 失败: ${JSON.stringify(data)}`);
    }
  }

  #scheduleReconnect() {
    if (this.closed) return;
    setTimeout(() => this.#connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
  }

  stop() {
    this.closed = true;
    if (this.ws) this.ws.close();
  }
}
