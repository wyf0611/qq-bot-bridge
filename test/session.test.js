import { SessionStore } from '../src/session.js';

const s = new SessionStore({ maxHistory: 3, idleTtlMs: 60000, persist: false });

// 追加 4 条，应只保留最近 3 条
s.get('private:1');
s.push('private:1', 'user', 'a');
s.push('private:1', 'assistant', 'b');
s.push('private:1', 'user', 'c');
s.push('private:1', 'assistant', 'd');

const hist = s.get('private:1');
console.log('hist len =', hist.length);
console.log('hist =', JSON.stringify(hist));

const ok = hist.length === 3 && hist[0].content === 'b' && hist[2].content === 'd';
console.log(ok ? 'SESSION_OK' : 'SESSION_FAIL');
process.exit(ok ? 0 : 1);
