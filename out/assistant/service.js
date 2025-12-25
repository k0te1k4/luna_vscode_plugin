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
        return (0, config_1.getAssistantConfig)().enabled;
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
        if (!baseCfg.enabled)
            throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
        if (!baseCfg.docEmbeddingModelUri) {
            throw new Error('Не задан luna.assistant.docEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
        }
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        const wikiRootAbs = path.join(ws, baseCfg.wikiSubmodulePath);
        const indexAbsPath = path.join(ws, baseCfg.indexStoragePath);
        // Передаём folderId (если задан) — это важно для x-folder-id
        const client = new yandexClient_1.YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });
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
        if (!baseCfg.enabled)
            throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        if (!baseCfg.queryEmbeddingModelUri) {
            throw new Error('Не задан luna.assistant.queryEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
        }
        if (!baseCfg.generationModelUri) {
            throw new Error('Не задан luna.assistant.generationModelUri (например gpt://<folderId>/yandexgpt-lite/latest).');
        }
        const indexAbsPath = path.join(ws, baseCfg.indexStoragePath);
        const idx = await (0, vectorIndex_1.loadIndex)(indexAbsPath);
        if (!idx)
            throw new Error('Индекс не найден. Выполните “LuNA: Reindex Wiki for Assistant”.');
        const client = new yandexClient_1.YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });
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
        return await client.completion(baseCfg.generationModelUri, [
            { role: 'system', text: system },
            { role: 'user', text: user }
        ], 1400, 0.2);
    }
    async explainSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            throw new Error('Нет активного редактора.');
        const doc = editor.document;
        if (!isExplainSupported(doc)) {
            throw new Error('Explain поддерживается только для файлов .fa и .cpp/.h/.hpp.');
        }
        const sel = editor.selection;
        const selected = sel && !sel.isEmpty ? doc.getText(sel) : '';
        if (!selected.trim())
            throw new Error('Нужно выделить фрагмент кода для объяснения.');
        const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
        if (!baseCfg.enabled)
            throw new Error('Ассистент выключен. Включите luna.assistant.enabled.');
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        if (!baseCfg.generationModelUri) {
            throw new Error('Не задан luna.assistant.generationModelUri. Пример: gpt://<folderId>/yandexgpt-lite/latest');
        }
        const code = clampTextByChars(selected, baseCfg.codeExplainMaxChars || 16000);
        const filePath = vscode.workspace.asRelativePath(doc.uri, false);
        const language = doc.languageId;
        const rangeStr = `L${sel.start.line + 1}:${sel.start.character + 1}–L${sel.end.line + 1}:${sel.end.character + 1}`;
        const system = 'Ты — ассистент разработчика. Объясняй код понятно и по делу. ' +
            'Если видишь проблемы/ошибки — перечисли их отдельно. ' +
            'Если можно улучшить — предложи конкретные варианты. ' +
            'Если не хватает контекста — скажи, что именно нужно.';
        const user = `Задача: объясни выделенный фрагмент кода.\n` +
            `Файл: ${filePath}\n` +
            `Диапазон: ${rangeStr}\n` +
            `Язык/тип: ${language}\n\n` +
            `Код:\n` +
            '```' +
            guessFence(language, filePath) +
            '\n' +
            code +
            '\n```';
        const client = new yandexClient_1.YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });
        const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LuNA: Explain selection', cancellable: true }, async (_progress, token) => {
            const signal = abortSignalFromCancellationToken(token);
            return await client.completion(baseCfg.generationModelUri, [
                { role: 'system', text: system },
                { role: 'user', text: user }
            ], 1200, 0.2, signal);
        });
        this.getOutput().appendLine(`--- Explain Selection: ${filePath} (${rangeStr}) ---`);
        this.getOutput().appendLine(answer.trim());
        this.getOutput().appendLine('');
        this.getOutput().show(true);
    }
    async explainFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            throw new Error('Нет активного редактора.');
        const doc = editor.document;
        if (!isExplainSupported(doc)) {
            throw new Error('Explain поддерживается только для файлов .fa и .cpp/.h/.hpp.');
        }
        const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
        if (!baseCfg.enabled)
            throw new Error('Ассистент выключен. Включите luna.assistant.enabled.');
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        if (!baseCfg.generationModelUri) {
            throw new Error('Не задан luna.assistant.generationModelUri. Пример: gpt://<folderId>/yandexgpt-lite/latest');
        }
        const filePath = vscode.workspace.asRelativePath(doc.uri, false);
        const language = doc.languageId;
        const code = clampTextByChars(doc.getText(), baseCfg.codeExplainMaxChars || 16000);
        const system = 'Ты — ассистент разработчика. Объясни файл: назначение, структура, важные функции/классы, ' +
            'как это работает, типичные ошибки и места для улучшений. ' +
            'Если файл слишком большой и обрезан — скажи, чего не хватает.';
        const user = `Задача: объясни файл целиком.\n` +
            `Файл: ${filePath}\n` +
            `Язык/тип: ${language}\n\n` +
            `Код:\n` +
            '```' +
            guessFence(language, filePath) +
            '\n' +
            code +
            '\n```';
        const client = new yandexClient_1.YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });
        const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LuNA: Explain file', cancellable: true }, async (_progress, token) => {
            const signal = abortSignalFromCancellationToken(token);
            return await client.completion(baseCfg.generationModelUri, [
                { role: 'system', text: system },
                { role: 'user', text: user }
            ], 1400, 0.2, signal);
        });
        this.getOutput().appendLine(`--- Explain File: ${filePath} ---`);
        this.getOutput().appendLine(answer.trim());
        this.getOutput().appendLine('');
        this.getOutput().show(true);
    }
    getOutput() {
        if (!this.output) {
            this.output = vscode.window.createOutputChannel('LuNA Assistant');
        }
        return this.output;
    }
}
exports.LunaAssistantService = LunaAssistantService;
function getWorkspaceRoot() {
    var _a, _b;
    return (_b = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.uri.fsPath;
}
function isExplainSupported(doc) {
    const fsPath = doc.uri.fsPath.toLowerCase();
    if (fsPath.endsWith('.fa'))
        return true;
    if (fsPath.endsWith('.cpp') || fsPath.endsWith('.cc') || fsPath.endsWith('.cxx'))
        return true;
    if (fsPath.endsWith('.h') || fsPath.endsWith('.hpp') || fsPath.endsWith('.hh'))
        return true;
    return false;
}
function clampTextByChars(s, maxChars) {
    if (s.length <= maxChars)
        return s;
    return s.slice(0, maxChars) + `\n\n/* …TRUNCATED: original length ${s.length} chars, limit ${maxChars}… */`;
}
function guessFence(languageId, filePath) {
    const fp = filePath.toLowerCase();
    if (fp.endsWith('.fa'))
        return 'luna';
    if (languageId.includes('cpp') || fp.endsWith('.cpp') || fp.endsWith('.hpp') || fp.endsWith('.h'))
        return 'cpp';
    return '';
}
/**
 * Convert VS Code CancellationToken -> AbortSignal (for fetch()).
 * Works on Node 18+ (VS Code extension host).
 */
function abortSignalFromCancellationToken(token) {
    if (!token)
        return undefined;
    const ac = new AbortController();
    if (token.isCancellationRequested) {
        ac.abort();
        return ac.signal;
    }
    token.onCancellationRequested(() => ac.abort());
    return ac.signal;
}
//# sourceMappingURL=service.js.map