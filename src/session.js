// 每聊天多轮上下文：历史追加/截断、空闲清理、可选持久化、串行锁
import fs from 'node:fs/promises';
import path from 'node:path';

export class SessionStore {
  constructor(opts = {}) {
    this.maxHistory = opts.maxHistory ?? 20;
    this.idleTtlMs = opts.idleTtlMs ?? 30 * 60 * 1000;
    this.persist = opts.persist ?? true;
    this.persistPath = opts.persistPath ?? 'data/sessions.json';
    this.sessions = new Map(); // chatId -> { messages: [{role,content}], lastActive }
    this.locks = new Map(); // chatId -> Promise（串行互斥）
    this.saveTimer = null;
  }

  async load() {
    if (!this.persist) return;
    try {
      const raw = await fs.readFile(this.persistPath, 'utf8');
      const data = JSON.parse(raw);
      for (const [id, s] of Object.entries(data)) {
        if (Array.isArray(s?.messages)) {
          this.sessions.set(id, { messages: s.messages, lastActive: Date.now() });
        }
      }
    } catch {
      // 首次启动无历史文件，忽略
    }
  }

  get(chatId) {
    this.#gc();
    let s = this.sessions.get(chatId);
    if (!s) {
      s = { messages: [], lastActive: Date.now() };
      this.sessions.set(chatId, s);
    }
    s.lastActive = Date.now();
    return s.messages;
  }

  push(chatId, role, content) {
    const s = this.sessions.get(chatId);
    if (!s) return;
    s.messages.push({ role, content });
    if (s.messages.length > this.maxHistory) {
      s.messages.splice(0, s.messages.length - this.maxHistory);
    }
    s.lastActive = Date.now();
    this.#scheduleSave();
  }

  // 同一聊天串行执行 fn，避免并发导致历史错乱
  async runExclusive(chatId, fn) {
    const prev = this.locks.get(chatId) ?? Promise.resolve();
    const next = prev.then(() => fn());
    this.locks.set(chatId, next.catch(() => {}));
    return next;
  }

  async save() {
    if (!this.persist) return;
    try {
      const out = {};
      for (const [id, s] of this.sessions) out[id] = { messages: s.messages };
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      await fs.writeFile(this.persistPath, JSON.stringify(out, null, 2), 'utf8');
    } catch (e) {
      console.error('[session] 持久化失败:', e.message);
    }
  }

  #gc() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastActive > this.idleTtlMs) this.sessions.delete(id);
    }
  }

  #scheduleSave() {
    if (!this.persist) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1000);
  }
}
