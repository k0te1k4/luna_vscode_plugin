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
const fs = __importStar(require("fs/promises"));
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const yandexClient_1 = require("./yandexClient");
const aiStudioClient_1 = require("./aiStudioClient");
const vectorStoreManager_1 = require("./vectorStoreManager");
async function deleteFilesBestEffort(client, fileIds, signal) {
    // Delete with small concurrency to avoid bursts.
    const concurrency = 3;
    let idx = 0;
    const workers = [];
    const runOne = async () => {
        for (;;) {
            if (signal === null || signal === void 0 ? void 0 : signal.aborted)
                return;
            const i = idx++;
            if (i >= fileIds.length)
                return;
            const id = fileIds[i];
            try {
                await client.deleteFile(id);
            }
            catch (_a) {
                // ignore (already deleted / not found / etc.)
            }
        }
    };
    for (let i = 0; i < Math.min(concurrency, fileIds.length); i++)
        workers.push(runOne());
    await Promise.all(workers);
}
class LunaAssistantService {
    constructor(context, kb) {
        this.context = context;
        this.kb = kb;
        // Webviews can steal focus; VS Code may report activeTextEditor as undefined.
        // Keep the last active editor so we can still grab "current file" context.
        this.lastActiveEditor = undefined;
        const sub = vscode.window.onDidChangeActiveTextEditor(ed => {
            if (ed)
                this.lastActiveEditor = ed;
        });
        this.context.subscriptions.push(sub);
        if (vscode.window.activeTextEditor)
            this.lastActiveEditor = vscode.window.activeTextEditor;
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
        var _a;
        const folder = this.kb.getActiveFolder();
        if (!folder)
            throw new Error('Откройте папку (workspace) в VS Code.');
        const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
        if (!baseCfg.enabled)
            throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        const version = this.kb.getVersionForFolder(folder);
        // 1) Sync wiki docs + user files from cloud (Object Storage) into local cache.
        const roots = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `LuNA Assistant: синхронизация базы знаний (${version})`,
            cancellable: true
        }, async (progress, token) => {
            // progress/token are VS Code types; keep as any to avoid strict typings issues in this repo snapshot.
            await this.kb.syncDocs(version, progress, token);
            await this.kb.syncUserFiles(version, progress, token);
            const docsRoot = this.kb.docsCacheRoot(version);
            const userRoot = this.kb.userFilesCacheRoot(version);
            const anyCount = (await countFilesByExt(docsRoot, new Set(['.md', '.markdown', '.txt', '.pdf']))) +
                (await countFilesByExt(userRoot, new Set(['.md', '.markdown', '.txt', '.pdf'])));
            if (anyCount === 0) {
                const kbCfg = vscode.workspace.getConfiguration('luna');
                const bucket = kbCfg.get('kb.storage.bucket', '');
                const basePrefix = kbCfg.get('kb.storage.basePrefix', 'luna-kb');
                throw new Error(`В облачной базе знаний не найдено документов для версии “${version}”.\n` +
                    `Ожидаемый путь: s3://${bucket}/${basePrefix}/${version}/docs/ (wiki) или .../${version}/user-files/ (ваши файлы)\n` +
                    `Загрузите .md/.txt/.pdf через “LuNA KB: Upload User Files (Assistant)” или проверьте, что docs/ существует.`);
            }
            return {
                docsRoot,
                userRoot
            };
        });
        // 2) Create (or recreate) Vector Store + upload docs via Files API + attach them to Vector Store.
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
        }
        const client = new aiStudioClient_1.YandexAIStudioClient({ apiKey, openaiProject: baseCfg.yandexFolderId });
        // Best-effort cleanup of Files uploaded during the previous reindex for this KB version.
        // Without this, AI Studio "Files" may accumulate duplicates over time.
        const metaKey = `luna.assistant.reindexMeta.${version}`;
        const prevMeta = this.context.globalState.get(metaKey);
        if ((_a = prevMeta === null || prevMeta === void 0 ? void 0 : prevMeta.uploadedFileIds) === null || _a === void 0 ? void 0 : _a.length) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `LuNA Assistant: очистка старых файлов AI Studio (${version})`,
                cancellable: false
            }, async () => {
                // 1) Delete previous vector store (best-effort). This helps ensure old content stops being retrieved.
                if (prevMeta.vectorStoreId) {
                    try {
                        await client.deleteVectorStore(prevMeta.vectorStoreId);
                    }
                    catch (_a) {
                        // ignore
                    }
                }
                // 2) Delete uploaded files (best-effort). Ignore errors (already deleted / in use / etc.).
                await deleteFilesBestEffort(client, prevMeta.uploadedFileIds);
            });
        }
        const storedKey = `luna.assistant.vectorStoreId.${version}`;
        const cfgVectorStoreId = baseCfg.vectorStoreId || this.context.globalState.get(storedKey) || '';
        const cfgWithVectorStore = { ...baseCfg, vectorStoreId: cfgVectorStoreId };
        const res = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `LuNA Assistant: создание Vector Store + загрузка файлов (${version})`,
            cancellable: true
        }, async (progress, token) => {
            // progress/token are VS Code types; keep as any to avoid strict typings issues in this repo snapshot.
            return await (0, vectorStoreManager_1.ensureVectorStoreWithFiles)({
                client,
                cfg: cfgWithVectorStore,
                kbVersion: version,
                roots: [
                    { rootAbs: roots.docsRoot, prefix: 'docs' },
                    { rootAbs: roots.userRoot, prefix: 'user-files' }
                ],
                progress,
                cancellationToken: token
            });
        });
        await this.context.globalState.update(storedKey, res.vectorStoreId);
        await this.context.globalState.update(metaKey, {
            vectorStoreId: res.vectorStoreId,
            uploadedFileIds: res.uploadedFileIds || [],
            createdAtIso: new Date().toISOString()
        });
        vscode.window.showInformationMessage(`LuNA Assistant: Vector Store готов (${version}). vectorStoreId=${res.vectorStoreId}`);
    }
    async ask(question, onDelta) {
        question = await this.maybeAugmentQuestionWithEditorContext(question);
        const folder = this.kb.getActiveFolder();
        if (!folder)
            throw new Error('Откройте папку (workspace) в VS Code.');
        const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
        if (!baseCfg.enabled)
            throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
        const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
        if (!apiKey)
            throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
        if (!baseCfg.generationModelUri) {
            throw new Error('Не задан luna.assistant.generationModelUri (например gpt://<folderId>/yandexgpt-lite/latest).');
        }
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
        }
        const version = this.kb.getVersionForFolder(folder);
        const vectorStoreId = this.context.globalState.get(`luna.assistant.vectorStoreId.${version}`);
        if (!vectorStoreId) {
            throw new Error('Vector Store для текущей версии базы знаний не найден. Сначала выполните “LuNA: Reindex Knowledge Base for Assistant”.');
        }
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
        }
        const client = new aiStudioClient_1.YandexAIStudioClient({ apiKey, openaiProject: baseCfg.yandexFolderId });
        const instruction = 'Ты — технический ассистент по языку LuNA. ' +
            'Отвечай по-русски. ' +
            'Если используешь сведения из базы знаний, указывай источники (файлы/страницы) и не выдумывай. ' +
            'Если ответа в базе знаний нет — честно скажи об этом и предложи, какие документы стоит дополнить.';
        const tools = [
            {
                type: 'file_search',
                vector_store_ids: [vectorStoreId],
                max_num_results: baseCfg.searchMaxResults || 6
            }
        ];
        if (baseCfg.enableWebSearch)
            tools.push({ type: 'web_search' });
        // Persist conversation per workspace folder via previous_response_id.
        const convKey = `luna.assistant.previousResponseId.${folder.uri.toString()}`;
        const previous = this.context.globalState.get(convKey) || undefined;
        let finalText = '';
        let finalResponse;
        await client.streamResponse({
            model: baseCfg.generationModelUri,
            previous_response_id: previous,
            input: [
                { role: 'system', content: [{ type: 'input_text', text: instruction }] },
                { role: 'user', content: [{ type: 'input_text', text: question }] }
            ],
            tool_choice: 'auto',
            tools
        }, (evt) => {
            var _a, _b;
            if (!evt || typeof evt !== 'object')
                return;
            if (evt.type === 'error') {
                throw new Error(evt.message || 'Response stream error');
            }
            if (evt.type === 'response.output_text.delta') {
                const d = (_b = (_a = evt.delta) !== null && _a !== void 0 ? _a : evt.delt) !== null && _b !== void 0 ? _b : '';
                if (d) {
                    finalText += d;
                    onDelta === null || onDelta === void 0 ? void 0 : onDelta(String(d));
                }
            }
            if (evt.type === 'response.completed') {
                finalResponse = evt.response;
            }
        });
        if (!finalResponse) {
            // Fallback (should not normally happen): request without stream.
            finalResponse = await client.createResponse({
                model: baseCfg.generationModelUri,
                previous_response_id: previous,
                input: [
                    { role: 'system', content: [{ type: 'input_text', text: instruction }] },
                    { role: 'user', content: [{ type: 'input_text', text: question }] }
                ],
                tools,
                tool_choice: 'auto'
            });
        }
        const { text, sources } = extractAnswerAndSources(finalResponse);
        finalText = text || finalText;
        if (finalResponse === null || finalResponse === void 0 ? void 0 : finalResponse.id) {
            void this.context.globalState.update(convKey, String(finalResponse.id));
        }
        return formatAnswerWithSources(finalText, sources);
    }

    /**
     * Если пользователь пишет в окне ассистента фразы вроде "в текущем файле" / "в открытой программе" /
     * "в редакторе" (или про выделение), то мы автоматически прикладываем текст из активного редактора.
     * Это убирает необходимость копировать код руками в чат.
     */
    async maybeAugmentQuestionWithEditorContext(question) {
        const q = String(question ?? '').trim();
        if (!q)
            return q;
        // IMPORTANT: Do NOT use \b word boundaries for Russian text.
        // JS regex word boundaries are ASCII-centric and won't reliably match Cyrillic.
        // Use normalized substring triggers instead.
        const qNorm = q.toLowerCase();
        const wantSelection = [
            'в выделенном',
            'в выделении',
            'в выделенном фрагменте',
            'в выделенном коде',
            'selected code',
            'selection'
        ].some(p => qNorm.includes(p));
        const wantFile = [
            'в текущем файле',
            'в текущей программе',
            'в открытой программе',
            'в открытом файле',
            'в активном файле',
            'в активном редакторе',
            'в редакторе',
            'current file',
            'open file',
            'active editor'
        ].some(p => qNorm.includes(p));
        if (!wantSelection && !wantFile)
            return q;
        // In WebView-based UIs VS Code may report activeTextEditor as undefined.
        // Fallback to the last active editor, and then to any visible text editor.
        const editor = vscode.window.activeTextEditor || this.lastActiveEditor || vscode.window.visibleTextEditors.find(e => (e === null || e === void 0 ? void 0 : e.document) && e.document.uri && e.document.uri.scheme === 'file');
        if (!editor)
            return q;
        const doc = editor.document;
        const baseCfg = withDerivedDefaults(getAssistantConfig());
        let code = '';
        let rangeStr = '';
        if (wantSelection && editor.selection && !editor.selection.isEmpty) {
            const sel = editor.selection;
            code = doc.getText(sel);
            rangeStr = `L${sel.start.line + 1}:${sel.start.character + 1}–L${sel.end.line + 1}:${sel.end.character + 1}`;
        }
        else if (wantFile) {
            code = doc.getText();
            rangeStr = `L1:1–L${doc.lineCount}:1`;
        }
        else {
            return q;
        }
        code = clampTextByChars(code, baseCfg.editorContextMaxChars || 20000);
        if (!code.trim())
            return q;
        const filePath = vscode.workspace.asRelativePath(doc.uri, false);
        const language = doc.languageId;
        const fence = guessFence(language, filePath);
        const header = (wantSelection && editor.selection && !editor.selection.isEmpty)
            ? `

---
Контекст из активного редактора (выделенный фрагмент)
Файл: ${filePath}
Диапазон: ${rangeStr}
Язык/тип: ${language}

Код:

`
            : `

---
Контекст из активного редактора (текущий файл)
Файл: ${filePath}
Диапазон: ${rangeStr}
Язык/тип: ${language}

Код:

`;
        return q + header + '```' + fence + '\n' + code + '\n```';
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
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
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
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
        }
        const client = new aiStudioClient_1.YandexAIStudioClient({ apiKey, openaiProject: baseCfg.yandexFolderId });
        const version = this.kb.getVersionForFolder(this.kb.getActiveFolder());
        const vectorStoreId = this.context.globalState.get(`luna.assistant.vectorStoreId.${version}`);
        if (!vectorStoreId) {
            throw new Error('Vector Store для текущей версии базы знаний не найден. Сначала выполните “LuNA: Reindex Knowledge Base for Assistant”.');
        }
        const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LuNA: Explain selection', cancellable: true }, async (_progress, token) => {
            void _progress;
            const tools = [
                { type: 'file_search', vector_store_ids: [vectorStoreId], max_num_results: baseCfg.searchMaxResults || 6 }
            ];
            if (baseCfg.enableWebSearch)
                tools.push({ type: 'web_search' });
            const resp = await client.createResponse({
                model: baseCfg.generationModelUri,
                input: [{ role: 'user', content: [{ type: 'input_text', text: `${system}\n\n${user}` }] }],
                tools,
                tool_choice: 'auto'
            });
            const { text, sources } = extractAnswerAndSources(resp);
            return formatAnswerWithSources(text, sources);
        });
        this.getOutput().appendLine(`--- Explain Selection: ${filePath} (${rangeStr}) ---`);
        this.getOutput().appendLine(answer.trim());
        this.getOutput().appendLine('');
        this.getOutput().show(true);
    }
    /**
     * Called when LuNA KB version for a workspace folder changes.
     * We drop all "tails" from the previous version: conversation state and vector store.
     */
    async handleVersionChange(folder, oldVersion, newVersion) {
        // 1) Reset conversation context for this workspace.
        const convKey = `luna.assistant.previousResponseId.${folder.uri.toString()}`;
        await this.context.globalState.update(convKey, undefined);
        // 2) Best-effort delete previous version vector store, so it can't be used by mistake.
        const oldVsKey = `luna.assistant.vectorStoreId.${oldVersion}`;
        const oldVsId = this.context.globalState.get(oldVsKey) || '';
        if (oldVsId) {
            try {
                const baseCfg = (0, config_1.withDerivedDefaults)((0, config_1.getAssistantConfig)());
                const apiKey = await (0, yandexClient_1.getApiKeyFromSecrets)(this.context);
                if (apiKey && baseCfg.yandexFolderId) {
                    const client = new aiStudioClient_1.YandexAIStudioClient({ apiKey, openaiProject: baseCfg.yandexFolderId });
                    await client.deleteVectorStore(oldVsId);
                }
            }
            catch (_a) {
                // ignore
            }
            await this.context.globalState.update(oldVsKey, undefined);
        }
        // 3) Remove local caches for the old version (wiki + user-files).
        try {
            await fs.rm(this.kb.docsCacheRoot(oldVersion), { recursive: true, force: true });
            await fs.rm(this.kb.userFilesCacheRoot(oldVersion), { recursive: true, force: true });
        }
        catch (_b) {
            // ignore
        }
        // 4) Force reindex for the new version (don’t accidentally use stale ID).
        const newVsKey = `luna.assistant.vectorStoreId.${newVersion}`;
        await this.context.globalState.update(newVsKey, undefined);
        vscode.window.showInformationMessage(`LuNA version changed: ${oldVersion} → ${newVersion}. Please run “LuNA: Reindex Knowledge Base for Assistant”.`);
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
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
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
        if (!baseCfg.yandexFolderId) {
            throw new Error('Не задан luna.assistant.yandexFolderId (это folderId каталога Yandex Cloud).');
        }
        const client = new aiStudioClient_1.YandexAIStudioClient({ apiKey, openaiProject: baseCfg.yandexFolderId });
        const version = this.kb.getVersionForFolder(this.kb.getActiveFolder());
        const vectorStoreId = this.context.globalState.get(`luna.assistant.vectorStoreId.${version}`);
        if (!vectorStoreId) {
            throw new Error('Vector Store для текущей версии базы знаний не найден. Сначала выполните “LuNA: Reindex Knowledge Base for Assistant”.');
        }
        const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LuNA: Explain file', cancellable: true }, async (_progress, token) => {
            void _progress;
            const tools = [
                { type: 'file_search', vector_store_ids: [vectorStoreId], max_num_results: baseCfg.searchMaxResults || 6 }
            ];
            if (baseCfg.enableWebSearch)
                tools.push({ type: 'web_search' });
            const resp = await client.createResponse({
                model: baseCfg.generationModelUri,
                input: [{ role: 'user', content: [{ type: 'input_text', text: `${system}\n\n${user}` }] }],
                tools,
                tool_choice: 'auto'
            });
            const { text, sources } = extractAnswerAndSources(resp);
            return formatAnswerWithSources(text, sources);
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
function extractAnswerAndSources(resp) {
    var _a;
    const sources = [];
    const texts = [];
    const output = (resp === null || resp === void 0 ? void 0 : resp.output) || (resp === null || resp === void 0 ? void 0 : resp.output_items) || [];
    for (const item of output) {
        if ((item === null || item === void 0 ? void 0 : item.type) !== 'message')
            continue;
        const content = (item === null || item === void 0 ? void 0 : item.content) || [];
        for (const part of content) {
            if ((part === null || part === void 0 ? void 0 : part.type) === 'output_text') {
                const t = String((part === null || part === void 0 ? void 0 : part.text) || '');
                if (t)
                    texts.push(t);
                const anns = (part === null || part === void 0 ? void 0 : part.annotations) || [];
                for (const a of anns) {
                    // File citations usually provide filename, plus optional page/line.
                    const file = (a === null || a === void 0 ? void 0 : a.filename) || ((_a = a === null || a === void 0 ? void 0 : a.file) === null || _a === void 0 ? void 0 : _a.filename) || (a === null || a === void 0 ? void 0 : a.file_name) || (a === null || a === void 0 ? void 0 : a.file_id) || undefined;
                    const quote = (a === null || a === void 0 ? void 0 : a.quote) || (a === null || a === void 0 ? void 0 : a.text) || undefined;
                    const page = typeof (a === null || a === void 0 ? void 0 : a.page_number) === 'number' ? a.page_number : typeof (a === null || a === void 0 ? void 0 : a.page) === 'number' ? a.page : undefined;
                    const line = (a === null || a === void 0 ? void 0 : a.line) || (a === null || a === void 0 ? void 0 : a.location) || undefined;
                    sources.push({ file, quote, page, line });
                }
            }
        }
    }
    return { text: texts.join('').trim(), sources: dedupeSources(sources) };
}
function dedupeSources(srcs) {
    const seen = new Set();
    const out = [];
    for (const s of srcs) {
        const key = JSON.stringify({ f: s.file || '', p: s.page || '', l: s.line || '', q: (s.quote || '').slice(0, 80) });
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}
function formatAnswerWithSources(answer, sources) {
    const a = (answer || '').trim();
    if (!(sources === null || sources === void 0 ? void 0 : sources.length))
        return a;
    const lines = [];
    lines.push(a);
    lines.push('');
    lines.push('Источники:');
    for (const s of sources.slice(0, 12)) {
        const parts = [];
        if (s.file)
            parts.push(s.file);
        if (typeof s.page === 'number')
            parts.push(`стр. ${s.page}`);
        if (s.line)
            parts.push(String(s.line));
        const head = parts.length ? parts.join(', ') : 'файл';
        if (s.quote) {
            const q = String(s.quote).replace(/\s+/g, ' ').trim();
            lines.push(`- ${head}: “${q.slice(0, 220)}${q.length > 220 ? '…' : ''}”`);
        }
        else {
            lines.push(`- ${head}`);
        }
    }
    if (sources.length > 12)
        lines.push(`- …и ещё ${sources.length - 12} источник(ов)`);
    return lines.join('\n');
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
async function countFilesByExt(rootAbs, exts) {
    try {
        const st = await fs.stat(rootAbs);
        if (!st.isDirectory())
            return 0;
    }
    catch (_a) {
        return 0;
    }
    let count = 0;
    const stack = [rootAbs];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch (_b) {
            continue;
        }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                stack.push(p);
            }
            else if (e.isFile()) {
                const ext = path.extname(e.name).toLowerCase();
                if (exts.has(ext))
                    count++;
            }
        }
    }
    return count;
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