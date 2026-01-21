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
exports.getAssistantConfig = getAssistantConfig;
exports.withDerivedDefaults = withDerivedDefaults;
const vscode = __importStar(require("vscode"));
function getAssistantConfig() {
    const cfg = vscode.workspace.getConfiguration('luna');
    return {
        enabled: cfg.get('assistant.enabled', false),
        yandexFolderId: cfg.get('assistant.yandexFolderId', ''),
        vectorStoreId: cfg.get('assistant.vectorStoreId', ''),
        vectorStoreNamePrefix: cfg.get('assistant.vectorStoreNamePrefix', 'luna-kb'),
        recreateVectorStoreOnReindex: cfg.get('assistant.recreateVectorStoreOnReindex', true),
        vectorStoreTtlDays: clamp(cfg.get('assistant.vectorStore.ttlDays', 365), 1, 3650),
        enableWebSearch: cfg.get('assistant.enableWebSearch', false),
        searchMaxResults: clamp(cfg.get('assistant.search.maxResults', 6), 1, 20),
        searchChunkMaxTokens: clamp(cfg.get('assistant.search.chunk.maxTokens', 0), 0, 2048),
        searchChunkOverlapTokens: clamp(cfg.get('assistant.search.chunk.overlapTokens', 0), 0, 1024),
        docEmbeddingModelUri: cfg.get('assistant.docEmbeddingModelUri', ''),
        queryEmbeddingModelUri: cfg.get('assistant.queryEmbeddingModelUri', ''),
        generationModelUri: cfg.get('assistant.generationModelUri', ''),
        codeExplainMaxChars: clamp(cfg.get('assistant.codeExplain.maxChars', 16000), 2000, 200000)
    };
}
function clamp(n, lo, hi) {
    if (Number.isNaN(n))
        return lo;
    return Math.max(lo, Math.min(hi, n));
}
/**
 * If user didn't fill explicit model URIs but did fill folderId, we can derive defaults.
 *
 * Per Yandex AI Studio docs:
 *  - emb://<folder_ID>/text-search-doc/latest
 *  - emb://<folder_ID>/text-search-query/latest
 */
function withDerivedDefaults(cfg) {
    if (!cfg.yandexFolderId)
        return cfg;
    return {
        ...cfg,
        docEmbeddingModelUri: cfg.docEmbeddingModelUri || `emb://${cfg.yandexFolderId}/text-search-doc/latest`,
        queryEmbeddingModelUri: cfg.queryEmbeddingModelUri || `emb://${cfg.yandexFolderId}/text-search-query/latest`
    };
}
//# sourceMappingURL=config.js.map