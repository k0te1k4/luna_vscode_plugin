"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureVectorStoreWithFiles = ensureVectorStoreWithFiles;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
function guessMimeTypeByExt(ext) {
    const e = ext.toLowerCase();
    if (e === '.md' || e === '.markdown')
        return 'text/markdown';
    if (e === '.txt')
        return 'text/plain';
    if (e === '.pdf')
        return 'application/pdf';
    return undefined;
}
async function walkFiles(rootAbs, exts) {
    const out = [];
    const stack = [rootAbs];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch (_a) {
            continue;
        }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory())
                stack.push(p);
            else if (e.isFile()) {
                const ext = path.extname(e.name).toLowerCase();
                if (exts.has(ext))
                    out.push(p);
            }
        }
    }
    out.sort();
    return out;
}
async function sleep(ms) {
    await new Promise(r => setTimeout(r, ms));
}
async function waitVectorStoreReady(client, vectorStoreId, opts) {
    var _a;
    const started = Date.now();
    const timeoutMs = 15 * 60 * 1000;
    for (;;) {
        if ((_a = opts === null || opts === void 0 ? void 0 : opts.signal) === null || _a === void 0 ? void 0 : _a.aborted)
            throw new Error('Cancelled');
        const vs = await client.getVectorStore(vectorStoreId);
        const status = String((vs === null || vs === void 0 ? void 0 : vs.status) || '');
        if (status === 'completed')
            return vs;
        if (status === 'expired')
            throw new Error('Vector store expired');
        if (Date.now() - started > timeoutMs)
            throw new Error(`Vector store processing timeout (id=${vectorStoreId})`);
        await sleep(1000);
    }
}
async function waitFileBatchReady(client, vectorStoreId, batchId, opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const started = Date.now();
    const timeoutMs = 30 * 60 * 1000;
    let lastMsg = '';
    let lastDone = -1;
    for (;;) {
        if ((_a = opts === null || opts === void 0 ? void 0 : opts.signal) === null || _a === void 0 ? void 0 : _a.aborted)
            throw new Error('Cancelled');
        const b = await client.getVectorStoreFileBatch(vectorStoreId, batchId);
        const st = String((b === null || b === void 0 ? void 0 : b.status) || '');
        // Best-effort progress reporting.
        // OpenAI-compatible APIs typically return `file_counts` (completed/failed/in_progress/total).
        const fc = (b === null || b === void 0 ? void 0 : b.file_counts) || (b === null || b === void 0 ? void 0 : b.fileCounts);
        const total = Number((_e = (_d = (_c = (_b = fc === null || fc === void 0 ? void 0 : fc.total) !== null && _b !== void 0 ? _b : fc === null || fc === void 0 ? void 0 : fc.all) !== null && _c !== void 0 ? _c : fc === null || fc === void 0 ? void 0 : fc.count) !== null && _d !== void 0 ? _d : opts === null || opts === void 0 ? void 0 : opts.totalFilesHint) !== null && _e !== void 0 ? _e : 0) || (opts === null || opts === void 0 ? void 0 : opts.totalFilesHint) || 0;
        const completed = Number((_h = (_g = (_f = fc === null || fc === void 0 ? void 0 : fc.completed) !== null && _f !== void 0 ? _f : fc === null || fc === void 0 ? void 0 : fc.succeeded) !== null && _g !== void 0 ? _g : fc === null || fc === void 0 ? void 0 : fc.done) !== null && _h !== void 0 ? _h : 0) || 0;
        const failed = Number((_k = (_j = fc === null || fc === void 0 ? void 0 : fc.failed) !== null && _j !== void 0 ? _j : fc === null || fc === void 0 ? void 0 : fc.error) !== null && _k !== void 0 ? _k : 0) || 0;
        const inProgress = Number((_m = (_l = fc === null || fc === void 0 ? void 0 : fc.in_progress) !== null && _l !== void 0 ? _l : fc === null || fc === void 0 ? void 0 : fc.inProgress) !== null && _m !== void 0 ? _m : 0) || 0;
        const elapsedSec = Math.floor((Date.now() - started) / 1000);
        const label = (opts === null || opts === void 0 ? void 0 : opts.label) ? `${opts.label}: ` : '';
        const countsPart = total > 0 ? `${completed}/${total}` : `${completed}`;
        const extraPart = total > 0 ? `, in_progress=${inProgress}, failed=${failed}` : '';
        const msg = `${label}индексация: ${st} (${countsPart}${extraPart}), прошло ${elapsedSec}s`;
        // Avoid spamming the UI: report only when something changes.
        if ((opts === null || opts === void 0 ? void 0 : opts.progress) && (msg !== lastMsg || completed !== lastDone)) {
            opts.progress.report({ message: msg });
            lastMsg = msg;
            lastDone = completed;
        }
        if (st === 'completed')
            return b;
        if (st === 'failed')
            throw new Error(`Vector store file batch failed (id=${batchId})`);
        if (st === 'cancelled')
            throw new Error(`Vector store file batch cancelled (id=${batchId})`);
        if (Date.now() - started > timeoutMs)
            throw new Error(`Vector store file batch timeout (id=${batchId})`);
        await sleep(1000);
    }
}
function is429(e) {
    const msg = String((e === null || e === void 0 ? void 0 : e.message) || '');
    return msg.includes('API error 429') || msg.includes('429');
}
async function with429Backoff(fn, what, maxAttempts = 8) {
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        }
        catch (e) {
            attempt++;
            if (!is429(e) || attempt >= maxAttempts)
                throw e;
            // Exponential backoff with cap.
            const delay = Math.min(60000, 1000 * Math.pow(2, attempt));
            await sleep(delay);
            void what;
        }
    }
}
async function ensureVectorStoreWithFiles(args) {
    var _a;
    const { client, cfg, kbVersion, roots, progress, cancellationToken } = args;
    const desiredName = `${cfg.vectorStoreNamePrefix || 'luna-kb'}-${kbVersion}`;
    // Try to find existing vector store by explicit id, then by name.
    let current;
    if (cfg.vectorStoreId) {
        try {
            current = await client.getVectorStore(cfg.vectorStoreId);
        }
        catch (_b) {
            current = undefined;
        }
    }
    if (!current) {
        const listed = await client.listVectorStores();
        current = (_a = listed === null || listed === void 0 ? void 0 : listed.data) === null || _a === void 0 ? void 0 : _a.find((x) => (x === null || x === void 0 ? void 0 : x.name) === desiredName);
    }
    if (current && cfg.recreateVectorStoreOnReindex) {
        progress === null || progress === void 0 ? void 0 : progress.report({ message: `Удаляю старый vector store: ${current.name}…` });
        try {
            await client.deleteVectorStore(current.id);
        }
        catch (_c) {
            // ignore
        }
        current = undefined;
    }
    if (!current) {
        progress === null || progress === void 0 ? void 0 : progress.report({ message: `Создаю vector store: ${desiredName}…` });
        const body = {
            name: desiredName,
            // Vector store expiration policy is required by API.
            expires_after: { anchor: 'last_active_at', days: cfg.vectorStoreTtlDays || 365 }
        };
        // Optional chunking strategy.
        if (cfg.searchChunkMaxTokens > 0) {
            body.chunking_strategy = {
                type: 'static',
                static: {
                    max_chunk_size_tokens: Math.max(100, Math.min(4096, cfg.searchChunkMaxTokens)),
                    chunk_overlap_tokens: Math.max(0, Math.min(2048, cfg.searchChunkOverlapTokens || 0))
                }
            };
        }
        current = await client.createVectorStore(body);
        if (!(current === null || current === void 0 ? void 0 : current.id))
            throw new Error('Не удалось создать vector store: ответ без id');
    }
    // Upload files.
    const exts = new Set(['.md', '.markdown', '.txt', '.pdf']);
    const filesWithRel = [];
    for (const r of roots) {
        const rootFiles = await walkFiles(r.rootAbs, exts);
        for (const abs of rootFiles) {
            const relInside = path.relative(r.rootAbs, abs).replace(/\\/g, '/');
            const rel = `${r.prefix.replace(/\/+$/, '')}/${relInside}`.replace(/\/+/g, '/');
            filesWithRel.push({ abs, rel });
        }
    }
    filesWithRel.sort((a, b) => a.rel.localeCompare(b.rel));
    const files = filesWithRel;
    if (!files.length)
        throw new Error('В локальном кэше базы знаний не найдено файлов .md/.txt/.pdf для индексации.');
    const uploadedFileIds = [];
    // Upload files first (this does NOT start indexing operations).
    for (let i = 0; i < files.length; i++) {
        if (cancellationToken === null || cancellationToken === void 0 ? void 0 : cancellationToken.isCancellationRequested)
            throw new Error('Cancelled');
        const abs = files[i].abs;
        const rel = files[i].rel;
        progress === null || progress === void 0 ? void 0 : progress.report({ message: `Загружаю файл ${i + 1}/${files.length}: ${rel}` });
        const buf = await fs.readFile(abs);
        const mime = guessMimeTypeByExt(path.extname(abs));
        const fileObj = await client.uploadFile({ filename: rel, content: buf, mimeType: mime, purpose: 'assistants' });
        uploadedFileIds.push(fileObj.id);
    }
    // Attach files to vector store using File Batches to avoid hitting the limit
    // of concurrent indexing operations.
    // 1 batch == 1 indexing operation. Keep it <= 10 concurrent ops quota.
    // We process batches sequentially, so this mainly controls payload size.
    const batchSize = 50;
    for (let start = 0; start < uploadedFileIds.length; start += batchSize) {
        if (cancellationToken === null || cancellationToken === void 0 ? void 0 : cancellationToken.isCancellationRequested)
            throw new Error('Cancelled');
        const slice = uploadedFileIds.slice(start, start + batchSize);
        progress === null || progress === void 0 ? void 0 : progress.report({ message: `Индексирую пакет ${Math.floor(start / batchSize) + 1}/${Math.ceil(uploadedFileIds.length / batchSize)} (${slice.length} файлов)…` });
        const body = {
            file_ids: slice
        };
        if (cfg.searchChunkMaxTokens > 0) {
            body.chunking_strategy = {
                type: 'static',
                static: {
                    max_chunk_size_tokens: Math.max(100, Math.min(4096, cfg.searchChunkMaxTokens)),
                    chunk_overlap_tokens: Math.max(0, Math.min(2048, cfg.searchChunkOverlapTokens || 0))
                }
            };
        }
        const batch = await with429Backoff(() => client.createVectorStoreFileBatch(current.id, body), 'createVectorStoreFileBatch');
        if (!(batch === null || batch === void 0 ? void 0 : batch.id))
            throw new Error('Не удалось создать file batch: ответ без id');
        await waitFileBatchReady(client, current.id, String(batch.id), {
            progress,
            label: `Пакет ${Math.floor(start / batchSize) + 1}/${Math.ceil(uploadedFileIds.length / batchSize)}`,
            totalFilesHint: slice.length
        });
    }
    progress === null || progress === void 0 ? void 0 : progress.report({ message: `Проверяю готовность vector store…` });
    await waitVectorStoreReady(client, current.id);
    return { vectorStoreId: current.id, uploadedFileIds };
}
//# sourceMappingURL=vectorStoreManager.js.map