// DeepSeek chat completions 流式调用（OpenAI 兼容协议 + SSE），支持文字/多模态
export class DeepSeekClient {
  constructor(config) {
    this.config = config;
  }

  async chat(messages, opts = {}) {
    const { apiKey, baseURL, model: defaultModel, timeoutMs = 120000, maxTokens = 4096 } = this.config;
    const model = opts.model || defaultModel;
    const max_tokens = opts.maxTokens ?? maxTokens;
    const t = opts.timeoutMs ?? timeoutMs;
    if (!apiKey) throw new Error('缺少 DeepSeek API key');

    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true, max_tokens }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      return await this.#readSse(res.body);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('DeepSeek 调用超时');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async #readSse(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') text += delta;
        } catch {
          // 忽略单帧解析失败，继续读后续帧
        }
      }
    }

    if (!text) throw new Error('DeepSeek 返回空回复');
    return text;
  }
}
