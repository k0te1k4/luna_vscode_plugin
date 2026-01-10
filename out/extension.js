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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const node_1 = require("vscode-languageclient/node");
const service_1 = require("./assistant/service");
const panel_1 = require("./assistant/panel");
const storage_1 = require("./kb/storage");
const service_2 = require("./kb/service");
const tree_1 = require("./kb/tree");
const projectsView_1 = require("./kb/projectsView");
const commands_1 = require("./kb/commands");
let client;
const LUNA_KEYWORDS = [
    'sub', 'df', 'cf', 'stealable', 'import',
    'request', 'req_count', 'delete',
    'nfparam', 'locator_cyclic', 'locator_replicating',
    'after', 'let', 'for', 'while', 'if',
    'int', 'real', 'string', 'name', 'value'
];
const LUNA_SNIPPETS = [
    {
        label: 'cf fragment',
        insertText: new vscode.SnippetString('cf ${1:name}: ${2:func}(${3:args});'),
        documentation: 'Фрагмент вычислений LuNA (code fragment)'
    },
    {
        label: 'sub block',
        insertText: new vscode.SnippetString('sub ${1:name}(${2:params}) {\n\t$0\n}'),
        documentation: 'Субпрограмма LuNA'
    },
    {
        label: 'recommendation block',
        insertText: new vscode.SnippetString('@ {\n\t${1:request x;}\n}'),
        documentation: 'Блок рекомендаций LuNA'
    }
];
function activate(context) {
    // --- Knowledge Base (Yandex Object Storage) ---
    const kbStorage = new storage_1.KnowledgeBaseStorage(context);
    const kbService = new service_2.KnowledgeBaseService(context, kbStorage);
    const kbTreeProvider = new tree_1.KnowledgeBaseTreeProvider(context, kbStorage);
    const projectsTreeProvider = new projectsView_1.LunaProjectsTreeProvider();
    // Register Tree Views
    vscode.window.createTreeView('lunaKnowledgeBaseView', { treeDataProvider: kbTreeProvider });
    vscode.window.createTreeView('lunaProjectsView', { treeDataProvider: projectsTreeProvider });
    // Status bar: KB version
    const kbStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    kbStatus.command = 'luna.kb.statusBar.selectVersion';
    kbStatus.show();
    context.subscriptions.push(kbStatus);
    (0, commands_1.registerKbCommands)({ context, kb: kbService, storage: kbStorage, tree: kbTreeProvider, projects: projectsTreeProvider, statusBar: kbStatus });
    // --- AI Assistant ---
    const assistant = new service_1.LunaAssistantService(context, kbService);
    const panel = new panel_1.AssistantPanel(context, {
        onAsk: async (q) => assistant.ask(q),
        onReindex: async () => assistant.reindexWiki()
    });
    // --- Commands (MUST match package.json exactly) ---
    context.subscriptions.push(vscode.commands.registerCommand('luna.assistant.open', async () => {
        var _a;
        try {
            panel.show();
        }
        catch (err) {
            vscode.window.showErrorMessage((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err));
        }
    }), vscode.commands.registerCommand('luna.assistant.reindexWiki', async () => {
        var _a;
        try {
            await assistant.reindexWiki();
        }
        catch (err) {
            vscode.window.showErrorMessage((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err));
        }
    }), vscode.commands.registerCommand('luna.assistant.toggle', async () => {
        var _a;
        try {
            await assistant.toggleEnabled();
            const enabled = await assistant.isEnabled();
            vscode.window.showInformationMessage(`LuNA AI Assistant: ${enabled ? 'enabled' : 'disabled'}.`);
        }
        catch (err) {
            vscode.window.showErrorMessage((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err));
        }
    }), vscode.commands.registerCommand('luna.assistant.setApiKey', async () => {
        var _a;
        try {
            await assistant.setApiKeyInteractively();
        }
        catch (err) {
            vscode.window.showErrorMessage((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err));
        }
    }), 
    // NEW: explain selection
    vscode.commands.registerCommand('luna.assistant.explainSelection', async () => {
        var _a;
        try {
            await assistant.explainSelection();
        }
        catch (err) {
            vscode.window.showErrorMessage((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err));
        }
    }), 
    // NEW: explain whole file
    vscode.commands.registerCommand('luna.assistant.explainFile', async () => {
        var _a;
        try {
            await assistant.explainFile();
        }
        catch (err) {
            vscode.window.showErrorMessage((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err));
        }
    }));
    // --- Status bar ---
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.command = 'luna.assistant.open';
    status.tooltip = 'LuNA AI Assistant (Knowledge Base RAG)';
    status.text = 'LuNA AI: off';
    status.show();
    context.subscriptions.push(status);
    const updateStatus = async () => {
        try {
            const enabled = await assistant.isEnabled();
            status.text = enabled ? 'LuNA AI: on' : 'LuNA AI: off';
        }
        catch (_a) {
            status.text = 'LuNA AI: ?';
        }
    };
    updateStatus();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('luna.assistant.enabled')) {
            updateStatus();
        }
    }));
    // --- Completion provider for .fa and ucodes.cpp ---
    const selector = [
        { scheme: 'file', language: 'luna' },
        { scheme: 'file', language: 'cpp', pattern: '**/ucodes.cpp' }
    ];
    const completionProvider = vscode.languages.registerCompletionItemProvider(selector, {
        provideCompletionItems() {
            const keywordItems = LUNA_KEYWORDS.map(kw => {
                const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
                item.insertText = kw;
                return item;
            });
            const snippetItems = LUNA_SNIPPETS.map(sn => {
                const item = new vscode.CompletionItem(sn.label, vscode.CompletionItemKind.Snippet);
                item.insertText = sn.insertText;
                item.documentation = new vscode.MarkdownString(sn.documentation);
                return item;
            });
            return [...keywordItems, ...snippetItems];
        }
    });
    context.subscriptions.push(completionProvider);
    // --- LSP client for LuNA (.fa) ---
    const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
    const serverOptions = {
        run: { module: serverModule, transport: node_1.TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: node_1.TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };
    const clientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'luna' },
            { scheme: 'file', language: 'cpp' } // если у тебя LSP реально понимает cpp — ок; иначе можно убрать
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{fa,cpp}')
        }
    };
    client = new node_1.LanguageClient('lunaLanguageServer', 'LuNA Language Server', serverOptions, clientOptions);
    client.start();
    // --- Suggest ucodes.cpp near .fa ---
    const faWatcher = vscode.workspace.createFileSystemWatcher('**/*.fa');
    faWatcher.onDidCreate(uri => checkOrSuggestUcodes(uri));
    faWatcher.onDidChange(uri => checkOrSuggestUcodes(uri));
    context.subscriptions.push(faWatcher);
}
async function checkOrSuggestUcodes(faUri) {
    const dir = path.dirname(faUri.fsPath);
    const ucodesPath = path.join(dir, 'ucodes.cpp');
    const ucodesUri = vscode.Uri.file(ucodesPath);
    try {
        await vscode.workspace.fs.stat(ucodesUri);
    }
    catch (_a) {
        const answer = await vscode.window.showInformationMessage('Для LuNA-проекта рядом с .fa обычно есть ucodes.cpp. Создать шаблон ucodes.cpp?', 'Да', 'Нет');
        if (answer === 'Да') {
            const template = [
                '#include <cstdio>',
                '',
                'extern "C" void my_kernel() {',
                '    std::printf("Hello from ucodes.cpp\\n");',
                '}',
                ''
            ].join('\n');
            await vscode.workspace.fs.writeFile(ucodesUri, Buffer.from(template, 'utf8'));
            const doc = await vscode.workspace.openTextDocument(ucodesUri);
            await vscode.window.showTextDocument(doc);
        }
    }
}
function deactivate() {
    if (!client)
        return undefined;
    return client.stop();
}
//# sourceMappingURL=extension.js.map