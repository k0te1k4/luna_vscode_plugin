"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YandexAiStudioClient = void 0;
exports.getApiKeyFromSecrets = getApiKeyFromSecrets;
exports.setApiKeyInSecrets = setApiKeyInSecrets;
class YandexAiStudioClient {
    constructor(opts) {
        // ---- Known YC AI Studio rate limits ----
        // Embeddings are commonly limited to 10 req/s. Keep a safety margin.
        // If you hit 429, reduce embedMaxRps / embedMaxConcurrency.
        this.embedMaxRps = 8;
        this.embedMaxConcurrency = 2;
        // Simple in-process scheduler to enforce RPS + concurrency.
        this.embedQueue = [];
        this.embedInFlight = 0;
        this.embedNextAllowedAt = 0;
        this.apiKey = opts.apiKey;
        this.folderId = opts.folderId;
    }
    scheduleEmbedding(fn) {
        return new Promise((resolve, reject) => {
            this.embedQueue.push({ run: fn, resolve, reject });
            void this.pumpEmbedQueue();
        });
    }
    async pumpEmbedQueue() {
        // Avoid concurrent pumps spinning.
        if (this.embedInFlight >= this.embedMaxConcurrency)
            return;
        if (this.embedQueue.length === 0)
            return;
        const now = Date.now();
        const minIntervalMs = Math.ceil(1000 / Math.max(1, this.embedMaxRps));
        const waitMs = Math.max(0, this.embedNextAllowedAt - now);
        if (waitMs > 0) {
            // Schedule a later pump.
            setTimeout(() => void this.pumpEmbedQueue(), waitMs);
            return;
        }
        const job = this.embedQueue.shift();
        if (!job)
            return;
        this.embedInFlight++;
        this.embedNextAllowedAt = Date.now() + minIntervalMs;
        try {
            const v = await job.run();
            job.resolve(v);
        }
        catch (e) {
            job.reject(e);
        }
        finally {
            this.embedInFlight--;
            // Keep draining.
            void this.pumpEmbedQueue();
        }
    }
    async postJson(url, body, signal) {
        const headers = {
            'Content-Type': 'application/json',
            // Yandex Cloud AI Studio auth
            Authorization: `Api-Key ${this.apiKey}`
        };
        // For many YC AI endpoints, x-folder-id is either required or helps routing.
        // Safe to send when folderId is known.
        if (this.folderId)
            headers['x-folder-id'] = this.folderId;
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) {
            const txt = await safeReadText(res);
            throw new YandexHttpError(res.status, txt);
        }
        return (await res.json());
    }
    /**
     * Embeddings API: POST https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding
     * modelUri example: emb://<folderId>/text-search-doc/latest
     */
    async embedText(modelUri, text, signal) {
        // Rate-limit + retry on transient failures (429 / 5xx).
        return await this.scheduleEmbedding(async () => {
            const maxAttempts = 8;
            let attempt = 0;
            // Base delay: start small, exponential backoff.
            let backoffMs = 250;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                attempt++;
                try {
                    const r = await this.postJson('https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding', { modelUri, text }, signal);
                    return r.embedding.map(v => (typeof v === 'string' ? Number(v) : v));
                }
                catch (e) {
                    const status = e instanceof YandexHttpError ? e.status : undefined;
                    const isRetryable = status === 429 || (typeof status === 'number' && status >= 500 && status <= 599);
                    if (!isRetryable || attempt >= maxAttempts) {
                        throw e;
                    }
                    // Jitter to avoid thundering herd.
                    const jitter = Math.floor(Math.random() * 200);
                    await sleep(backoffMs + jitter);
                    backoffMs = Math.min(10000, backoffMs * 2);
                }
            }
        });
    }
    /**
     * Chat Completions API (OpenAI-compatible):
     * POST https://llm.api.cloud.yandex.net/v1/chat/completions
     *
     * model should be like: gpt://<folderId>/<modelId>/latest
     */
    async completion(model, messages, maxTokens = 1024, temperature = 0.2, signal) {
        var _a, _b, _c;
        const resolvedModel = this.resolveChatModel(model);
        const chatMessages = messages.map(m => ({
            role: m.role,
            content: m.text
        }));
        const r = await this.postJson('https://llm.api.cloud.yandex.net/v1/chat/completions', {
            model: resolvedModel,
            temperature,
            max_tokens: maxTokens,
            messages: chatMessages
        }, signal);
        const text = (_c = (_b = (_a = r === null || r === void 0 ? void 0 : r.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content;
        if (!text) {
            throw new Error(`Unexpected chat.completions response shape: ${JSON.stringify(r).slice(0, 700)}`);
        }
        return text;
    }
    /**
     * Accepts:
     *  - full "gpt://<folderId>/<modelId>/latest"
     *  - or "<modelId>" (if folderId exists): "yandexgpt" / "yandexgpt-lite"
     */
    resolveChatModel(model) {
        var _a, _b;
        const m = (model || '').trim();
        if (!m)
            throw new Error('generationModelUri/model is empty');
        // Common misconfigs:
        if (m.startsWith('emb://')) {
            throw new Error(`Invalid generation model "${m}". It looks like embeddings modelUri (emb://...). ` +
                `For chat use: gpt://<folderId>/<modelId>/latest (e.g. gpt://${(_a = this.folderId) !== null && _a !== void 0 ? _a : '<folderId>'}/yandexgpt-lite/latest)`);
        }
        if (m.startsWith('http://') || m.startsWith('https://')) {
            throw new Error(`Invalid generation model "${m}". Do not pass URL here. ` +
                `Use: gpt://<folderId>/<modelId>/latest (e.g. gpt://${(_b = this.folderId) !== null && _b !== void 0 ? _b : '<folderId>'}/yandexgpt-lite/latest)`);
        }
        if (m.startsWith('gpt://'))
            return m;
        if (this.folderId)
            return `gpt://${this.folderId}/${m}/latest`;
        throw new Error(`Invalid chat model: "${model}". Expected "gpt://<folderId>/<modelId>/latest" or provide folderId.`);
    }
}
exports.YandexAiStudioClient = YandexAiStudioClient;
class YandexHttpError extends Error {
    constructor(status, body) {
        super(`Yandex AI Studio HTTP ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function safeReadText(res) {
    try {
        return await res.text();
    }
    catch (_a) {
        return '<no-body>';
    }
}
async function getApiKeyFromSecrets(context) {
    return await context.secrets.get('luna.assistant.yandexApiKey');
}
async function setApiKeyInSecrets(context, apiKey) {
    await context.secrets.store('luna.assistant.yandexApiKey', apiKey);
}
//# sourceMappingURL=yandexClient.js.map