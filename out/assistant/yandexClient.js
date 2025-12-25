"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YandexAiStudioClient = void 0;
exports.getApiKeyFromSecrets = getApiKeyFromSecrets;
exports.setApiKeyInSecrets = setApiKeyInSecrets;
class YandexAiStudioClient {
    constructor(opts) {
        this.apiKey = opts.apiKey;
        this.folderId = opts.folderId;
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
            throw new Error(`Yandex AI Studio HTTP ${res.status}: ${txt}`);
        }
        return (await res.json());
    }
    /**
     * Embeddings API: POST https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding
     * modelUri example: emb://<folderId>/text-search-doc/latest
     */
    async embedText(modelUri, text, signal) {
        const r = await this.postJson('https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding', { modelUri, text }, signal);
        return r.embedding.map(v => (typeof v === 'string' ? Number(v) : v));
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