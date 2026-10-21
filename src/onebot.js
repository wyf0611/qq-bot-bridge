// OneBot v11 接入层：正向 WebSocket 收事件、HTTP API 发消息、私聊/群@ 过滤、超长分片
import WebSocket from 'ws';

export class OneBotClient {
  constructor(config, handlers) {
    this.wsUrl = config.wsUrl;
    this.httpUrl = config.httpUrl;
    this.selfId = config.selfId || 0;
    this.handlers = handlers; // { onMessage({ chatId, type, text, userId, groupId }) }
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
      this.#onMessage(msg);
    } else if (msg.post_type === 'meta_event' && msg.meta_event_type === 'lifecycle') {
      if (msg.self_id && !this.selfId) {
        this.selfId = msg.self_id;
        console.log('[onebot] self_id 探测为', msg.self_id);
      }
    }
  }

  #onMessage(event) {
    const userId = event.user_id;
    if (this.selfId && userId === this.selfId) return; // 不回自己，避免回环

    if (event.message_type === 'private') {
      const text = this.#extractText(event.message);
      this.handlers.onMessage({
        chatId: `private:${userId}`,
        type: 'private',
        text,
        userId,
        groupId: null,
      });
      return;
    }

    if (event.message_type === 'group') {
      if (!this.#isAtSelf(event.message)) return; // 群聊仅 @ 触发
      const text = this.#extractText(event.message);
      this.handlers.onMessage({
        chatId: `group:${event.group_id}`,
        type: 'group',
        text,
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
