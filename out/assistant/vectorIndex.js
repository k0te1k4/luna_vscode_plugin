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
exports.loadIndex = loadIndex;
exports.saveIndex = saveIndex;
exports.cosineSim = cosineSim;
exports.topKBySimilarity = topKBySimilarity;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
async function loadIndex(indexAbsPath) {
    try {
        const raw = await fs.readFile(indexAbsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if ((parsed === null || parsed === void 0 ? void 0 : parsed.schemaVersion) !== 1 || !Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.chunks))
            return null;
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
async function saveIndex(indexAbsPath, idx) {
    await fs.mkdir(path.dirname(indexAbsPath), { recursive: true });
    await fs.writeFile(indexAbsPath, JSON.stringify(idx, null, 2), 'utf8');
}
function cosineSim(a, b) {
    var _a, _b;
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
        const x = (_a = a[i]) !== null && _a !== void 0 ? _a : 0;
        const y = (_b = b[i]) !== null && _b !== void 0 ? _b : 0;
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    const den = Math.sqrt(na) * Math.sqrt(nb);
    if (!den)
        return 0;
    return dot / den;
}
function topKBySimilarity(query, chunks, k) {
    const scored = chunks.map(chunk => ({ chunk, score: cosineSim(query, chunk.embedding) }));
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, Math.max(1, k));
}
//# sourceMappingURL=vectorIndex.js.map