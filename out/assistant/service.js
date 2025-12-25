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
exports.LunaAssistantService = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const indexer_1 = require("./indexer");
const config_1 = require("./config");
const yandexClient_1 = require("./yandexClient");
const vectorIndex_1 = require("./vectorIndex");
class LunaAssistantService {
    constructor(context) {
        this.context = context;
    }
    async isEnabled() {
        const cfg = (0, config_1.getAssistantConfig)();
        return cfg.enabled;
    }
    async toggleEnabled() {
        const cfg = vscode.workspace.getConfiguration('luna');
        const cur = cfg.get('assistant.enabled', false);
        await cfg.update('assistant.enabled', !cur, vscode.ConfigurationTarget.Workspace);
    }
    async setApiKeyInteractively() {
        const key = await vscode.window.showInputBox({
            prompt: 'Введите Yandex Cloud AI Studio API key (будет сохранён в Secret Storage VS Code)',
            password: true,
            ignoreFocusOut: true
        });
        if (!key)
            return;
        await (0, yandexClient_1.setApiKeyInSecrets)(this.context, key.trim());
        vscode.window.showInformationMessage('API key сохранён.');
    }
    async reindexWiki() {
        const ws = getWorkspaceRoot();
        if (!ws)
            throw new Error('Откройте папку (workspace) в VS Code.');
        const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
        if (!baseCfg.enabled) {
            throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
        }
        if (!baseCfg.docEmbeddingModelUri) {
            throw new Error('Не задан luna.assistant.docEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
        }
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey) {
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        }
        const wikiRootAbs = path.join(ws, baseCfg.wikiSubmodulePath);
        const indexAbsPath = path.join(ws, baseCfg.indexStoragePath);
        const client = new yandexClient_1.YandexAiStudioClient({ apiKey });
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'LuNA Assistant: индексация wiki',
            cancellable: true
        }, async (progress, token) => {
            await (0, indexer_1.buildWikiIndex)({
                wikiRootAbs,
                indexAbsPath,
                docEmbeddingModelUri: baseCfg.docEmbeddingModelUri,
                chunkChars: baseCfg.chunkChars,
                client,
                cancellationToken: token,
                progress
            });
        });
        vscode.window.showInformationMessage('LuNA Assistant: индекс wiki готов.');
    }
    async ask(question) {
        const ws = getWorkspaceRoot();
        if (!ws)
            throw new Error('Откройте папку (workspace) в VS Code.');
        const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
        if (!baseCfg.enabled) {
            throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
        }
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        if (!baseCfg.queryEmbeddingModelUri) {
            throw new Error('Не задан luna.assistant.queryEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
        }
        if (!baseCfg.generationModelUri) {
            throw new Error('Не задан luna.assistant.generationModelUri.');
        }
        const indexAbsPath = path.join(ws, baseCfg.indexStoragePath);
        const idx = await (0, vectorIndex_1.loadIndex)(indexAbsPath);
        if (!idx) {
            throw new Error('Индекс не найден. Выполните “LuNA: Reindex Wiki for Assistant”.');
        }
        const client = new yandexClient_1.YandexAiStudioClient({ apiKey });
        const qEmb = await client.embedText(baseCfg.queryEmbeddingModelUri, question);
        const top = (0, vectorIndex_1.topKBySimilarity)(qEmb, idx.chunks, baseCfg.topK);
        const contextBlocks = top
            .map((t, i) => {
            const head = t.chunk.heading ? ` — ${t.chunk.heading}` : '';
            return `[#${i + 1}] ${t.chunk.sourcePath}${head}\n${t.chunk.text}`;
        })
            .join('\n\n');
        const system = 'Ты — технический ассистент по языку LuNA. Отвечай ТОЛЬКО на основе переданного контекста wiki. ' +
            'Если в контексте нет ответа, честно скажи, что в wiki этого нет, и предложи, какой файл/раздел стоит дополнить.';
        const user = `Контекст (фрагменты wiki):\n\n${contextBlocks}\n\n` +
            `Вопрос: ${question}\n\n` +
            'Сформулируй ответ по-русски. Если используешь факты, укажи ссылки на номера фрагментов [#1], [#2], ...';
        const answer = await client.completion(baseCfg.generationModelUri, [
            { role: 'system', text: system },
            { role: 'user', text: user }
        ], 1400, 0.2);
        return answer;
    }
}
exports.LunaAssistantService = LunaAssistantService;
function getWorkspaceRoot() {
    var _a, _b;
    const ws = (_b = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.uri.fsPath;
    return ws;
}
//# sourceMappingURL=service.js.map