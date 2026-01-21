"use strict";
/*
 * Minimal REST client for Yandex Cloud AI Studio OpenAI-compatible APIs.
 *
 * Endpoints:
 *  - Responses:     POST https://ai.api.cloud.yandex.net/v1/responses
 *  - Files:         POST https://ai.api.cloud.yandex.net/v1/files (multipart/form-data)
 *  - Vector stores: https://ai.api.cloud.yandex.net/v1/vector_stores
 *
 * Auth:
 *  - Authorization: Api-Key <API_KEY>
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.YandexAIStudioClient = void 0;
class YandexAIStudioClient {
    constructor(opts) {
        this.opts = opts;
        this.base = 'https://ai.api.cloud.yandex.net/v1';
    }
    headers(extra) {
        return {
            Authorization: `Api-Key ${this.opts.apiKey}`,
            'OpenAI-Project': this.opts.openaiProject,
            ...extra
        };
    }
    async req(method, url, body, signal) {
        var _a;
        const hasBody = body !== undefined && body !== null;
        const res = await fetch(url, {
            method,
            headers: hasBody && !(body instanceof FormData) ? this.headers({ 'Content-Type': 'application/json' }) : this.headers(),
            body: hasBody ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
            signal
        });
        const text = await res.text();
        if (!res.ok) {
            let msg = text;
            try {
                const j = JSON.parse(text);
                msg = (j === null || j === void 0 ? void 0 : j.message) || ((_a = j === null || j === void 0 ? void 0 : j.error) === null || _a === void 0 ? void 0 : _a.message) || JSON.stringify(j);
            }
            catch (_b) {
                // ignore
            }
            throw new Error(`Yandex AI Studio API error ${res.status}: ${msg}`);
        }
        if (!text)
            return undefined;
        try {
            return JSON.parse(text);
        }
        catch (_c) {
            return text;
        }
    }
    // -------------------- Responses API --------------------
    async createResponse(body, opts) {
        return await this.req('POST', `${this.base}/responses`, body, opts === null || opts === void 0 ? void 0 : opts.signal);
    }
    /**
     * Streaming variant of createResponse.
     * Yandex AI Studio implements OpenAI-compatible SSE streaming: `stream: true`.
     */
    async streamResponse(body, onEvent, opts) {
        const res = await fetch(`${this.base}/responses`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ ...body, stream: true }),
            signal: opts === null || opts === void 0 ? void 0 : opts.signal
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Yandex AI Studio API error ${res.status}: ${text}`);
        }
        if (!res.body)
            return;
        // SSE: lines like `data: {...}` and `data: [DONE]`.
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            // Split by \n\n (SSE event separator). Keep tail in buf.
            const parts = buf.split(/\n\n/);
            buf = parts.pop() || '';
            for (const part of parts) {
                // We only care about `data:` lines.
                const lines = part.split(/\n/);
                for (const line of lines) {
                    const m = /^data:\s*(.*)\s*$/.exec(line);
                    if (!m)
                        continue;
                    const payload = m[1];
                    if (!payload)
                        continue;
                    if (payload === '[DONE]')
                        return;
                    try {
                        const evt = JSON.parse(payload);
                        onEvent(evt);
                    }
                    catch (_a) {
                        // ignore malformed
                    }
                }
            }
        }
    }
    // -------------------- Files API --------------------
    async uploadFile(args) {
        const form = new FormData();
        // TS/DOM typings can be picky about Uint8Array<ArrayBufferLike>; normalize to ArrayBuffer.
        const contentArrayBuffer = args.content.buffer instanceof ArrayBuffer ? args.content.buffer : args.content.slice(0).buffer;
        const blob = new Blob([contentArrayBuffer], { type: args.mimeType || 'application/octet-stream' });
        form.append('file', blob, args.filename);
        form.append('purpose', args.purpose || 'assistants');
        return await this.req('POST', `${this.base}/files`, form);
    }
    async deleteFile(fileId) {
        await this.req('DELETE', `${this.base}/files/${encodeURIComponent(fileId)}`);
    }
    // -------------------- Vector stores API --------------------
    async listVectorStores() {
        return await this.req('GET', `${this.base}/vector_stores`);
    }
    async getVectorStore(vectorStoreId) {
        return await this.req('GET', `${this.base}/vector_stores/${encodeURIComponent(vectorStoreId)}`);
    }
    async createVectorStore(body) {
        return await this.req('POST', `${this.base}/vector_stores`, body);
    }
    async deleteVectorStore(vectorStoreId) {
        await this.req('DELETE', `${this.base}/vector_stores/${encodeURIComponent(vectorStoreId)}`);
    }
    async createVectorStoreFile(vectorStoreId, body) {
        return await this.req('POST', `${this.base}/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, body);
    }
    async getVectorStoreFile(vectorStoreId, vectorStoreFileId) {
        return await this.req('GET', `${this.base}/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(vectorStoreFileId)}`);
    }
    // -------------------- Vector store file batches --------------------
    async createVectorStoreFileBatch(vectorStoreId, body) {
        return await this.req('POST', `${this.base}/vector_stores/${encodeURIComponent(vectorStoreId)}/file_batches`, body);
    }
    async getVectorStoreFileBatch(vectorStoreId, batchId) {
        return await this.req('GET', `${this.base}/vector_stores/${encodeURIComponent(vectorStoreId)}/file_batches/${encodeURIComponent(batchId)}`);
    }
}
exports.YandexAIStudioClient = YandexAIStudioClient;
//# sourceMappingURL=aiStudioClient.js.map