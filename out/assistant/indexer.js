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
exports.buildWikiIndex = buildWikiIndex;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const vectorIndex_1 = require("./vectorIndex");
async function buildWikiIndex(params) {
    var _a, _b, _c, _d;
    // Reuse embeddings from an existing index when possible to reduce API calls.
    const prev = await (0, vectorIndex_1.loadIndex)(params.indexAbsPath);
    const prevMap = new Map();
    if (prev && prev.modelUri === params.docEmbeddingModelUri && prev.chunkChars === params.chunkChars) {
        for (const c of prev.chunks) {
            prevMap.set(makeChunkKey(c.sourcePath, c.heading, c.text), c);
        }
    }
    const mdFiles = await collectMarkdownFiles(params.wikiRootAbs);
    const plans = [];
    for (const abs of mdFiles) {
        const rel = normalizeRel(path.relative(params.wikiRootAbs, abs));
        const raw = await fs.readFile(abs, 'utf8');
        const docPlans = chunkMarkdown(raw, params.chunkChars).map(p => ({ ...p, sourcePath: rel }));
        plans.push(...docPlans);
    }
    const chunks = [];
    const total = plans.length;
    let done = 0;
    for (const plan of plans) {
        if ((_a = params.cancellationToken) === null || _a === void 0 ? void 0 : _a.isCancellationRequested) {
            throw new Error('Indexing cancelled');
        }
        (_b = params.progress) === null || _b === void 0 ? void 0 : _b.report({ message: `Embedding: ${plan.sourcePath}`, increment: (1 / Math.max(1, total)) * 100 });
        const key = makeChunkKey(plan.sourcePath, plan.heading, plan.text);
        const reused = prevMap.get(key);
        const embedding = (_c = reused === null || reused === void 0 ? void 0 : reused.embedding) !== null && _c !== void 0 ? _c : (await params.client.embedText(params.docEmbeddingModelUri, plan.text));
        // Use full-text hash in id so edits invalidate the chunk.
        const id = `${plan.sourcePath}::${hashForId((_d = plan.heading) !== null && _d !== void 0 ? _d : '')}::${hashForId(plan.text)}`;
        chunks.push({ id, sourcePath: plan.sourcePath, heading: plan.heading, text: plan.text, embedding });
        done++;
    }
    const idx = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        modelUri: params.docEmbeddingModelUri,
        chunkChars: params.chunkChars,
        chunks
    };
    await (0, vectorIndex_1.saveIndex)(params.indexAbsPath, idx);
    return idx;
}
function makeChunkKey(sourcePath, heading, text) {
    // Used only for reuse. Keep stable and based on content.
    return `${sourcePath}::${heading !== null && heading !== void 0 ? heading : ''}::${hashForId(text)}`;
}
async function collectMarkdownFiles(root) {
    const out = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === '.git' || e.name === 'node_modules')
                    continue;
                await walk(abs);
            }
            else if (e.isFile()) {
                const low = e.name.toLowerCase();
                if (low.endsWith('.md') || low.endsWith('.markdown') || low.endsWith('.txt'))
                    out.push(abs);
            }
        }
    }
    await walk(root);
    out.sort();
    return out;
}
function normalizeRel(rel) {
    return rel.split(path.sep).join('/');
}
/**
 * Very simple Markdown chunking:
 *  - split by headings (#, ##, ...)
 *  - inside each section, further split by approximate char size
 */
function chunkMarkdown(md, chunkChars) {
    var _a;
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    let cur = { heading: null, lines: [] };
    for (const line of lines) {
        const m = line.match(/^(#{1,6})\s+(.*)$/);
        if (m) {
            if (cur.lines.length)
                sections.push(cur);
            cur = { heading: ((_a = m[2]) === null || _a === void 0 ? void 0 : _a.trim()) || null, lines: [line] };
        }
        else {
            cur.lines.push(line);
        }
    }
    if (cur.lines.length)
        sections.push(cur);
    const out = [];
    for (const sec of sections) {
        const text = sec.lines.join('\n').trim();
        if (!text)
            continue;
        if (text.length <= chunkChars) {
            out.push({ heading: sec.heading, text });
            continue;
        }
        // Further split by paragraph boundary.
        const paras = text.split(/\n\n+/g);
        let buf = '';
        for (const p of paras) {
            const next = buf ? `${buf}\n\n${p}` : p;
            if (next.length > chunkChars && buf) {
                out.push({ heading: sec.heading, text: buf.trim() });
                buf = p;
            }
            else {
                buf = next;
            }
        }
        if (buf.trim())
            out.push({ heading: sec.heading, text: buf.trim() });
    }
    return out;
}
function hashForId(s) {
    // Non-cryptographic, stable across runs.
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
//# sourceMappingURL=indexer.js.map