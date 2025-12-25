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
    const assistant = new service_1.LunaAssistantService(context);
    const panel = new panel_1.AssistantPanel(context, {
        onAsk: async (q) => assistant.ask(q),
        onReindex: async () => assistant.reindexWiki()
    });
    context.subscriptions.push(vscode.commands.registerCommand('luna.assistant.open', () => panel.show()), vscode.commands.registerCommand('luna.assistant.reindexWiki', () => assistant.reindexWiki()), vscode.commands.registerCommand('luna.assistant.toggle', async () => {
        await assistant.toggleEnabled();
        const enabled = await assistant.isEnabled();
        vscode.window.showInformationMessage(`LuNA AI Assistant: ${enabled ? 'enabled' : 'disabled'}.`);
    }), vscode.commands.registerCommand('luna.assistant.setApiKey', () => assistant.setApiKeyInteractively()));
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.command = 'luna.assistant.open';
    status.tooltip = 'LuNA AI Assistant (Wiki RAG)';
    status.text = 'LuNA AI: off';
    status.show();
    context.subscriptions.push(status);
    const updateStatus = async () => {
        const enabled = await assistant.isEnabled();
        status.text = enabled ? 'LuNA AI: on' : 'LuNA AI: off';
    };
    updateStatus();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('luna.assistant.enabled')) {
            updateStatus();
        }
    }));
    // Общий провайдер автодополнения для .fa и ucodes.cpp
    const selector = [
        { scheme: 'file', language: 'luna' },
        { scheme: 'file', language: 'cpp', pattern: '**/ucodes.cpp' }
    ];
    const completionProvider = vscode.languages.registerCompletionItemProvider(selector, {
        provideCompletionItems(document, position) {
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
    // LSP-клиент для LuNA (.fa)
    const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
    const serverOptions = {
        run: { module: serverModule, transport: node_1.TransportKind.ipc },
        debug: { module: serverModule, transport: node_1.TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } }
    };
    const clientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'luna' },
            { scheme: 'file', language: 'cpp' } // ← добавили поддержку C++ (ucodes.cpp)
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{fa,cpp}')
        }
    };
    client = new node_1.LanguageClient('lunaLanguageServer', 'LuNA Language Server', serverOptions, clientOptions);
    client.start();
    // Предложение создать ucodes.cpp, если его нет рядом с .fa
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
    if (!client) {
        return undefined;
    }
    return client.stop();
}
//# sourceMappingURL=extension.js.map