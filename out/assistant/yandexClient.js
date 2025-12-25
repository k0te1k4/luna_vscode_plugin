"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YandexAiStudioClient = void 0;
exports.getApiKeyFromSecrets = getApiKeyFromSecrets;
exports.setApiKeyInSecrets = setApiKeyInSecrets;
class YandexAiStudioClient {
    constructor(opts) {
        this.apiKey = opts.apiKey;
    }
    async postJson(url, body, signal) {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // AI Studio auth: Authorization: Api-Key <API_key>
                // https://yandex.cloud/en/docs/ai-studio/api-ref/authentication
                Authorization: `Api-Key ${this.apiKey}`
            },
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
     */
    async embedText(modelUri, text, signal) {
        const r = await this.postJson('https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding', { modelUri, text }, signal);
        // API doc says "string" but actual values are numeric; normalize.
        return r.embedding.map(v => (typeof v === 'string' ? Number(v) : v));
    }
    /**
     * Text generation API (sync): POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion
     */
    async completion(modelUri, messages, maxTokens = 1024, temperature = 0.2, signal) {
        var _a, _b, _c, _d;
        const r = await this.postJson('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
            modelUri,
            completionOptions: {
                stream: false,
                temperature,
                maxTokens: String(maxTokens)
            },
            messages
        }, signal);
        // Response format: result.alternatives[0].message.text is common.
        const text = (_d = (_c = (_b = (_a = r === null || r === void 0 ? void 0 : r.result) === null || _a === void 0 ? void 0 : _a.alternatives) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.text;
        if (!text) {
            throw new Error(`Unexpected completion response shape: ${JSON.stringify(r).slice(0, 500)}`);
        }
        return text;
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
/**
 * Helper: stored under a stable secret key name.
 */
async function getApiKeyFromSecrets(context) {
    return await context.secrets.get('luna.assistant.yandexApiKey');
}
async function setApiKeyInSecrets(context, apiKey) {
    await context.secrets.store('luna.assistant.yandexApiKey', apiKey);
}
//# sourceMappingURL=yandexClient.js.map