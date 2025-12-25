
import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

import { LunaAssistantService } from './assistant/service';
import { AssistantPanel } from './assistant/panel';

let client: LanguageClient | undefined;

const LUNA_KEYWORDS = [
  'sub', 'df', 'cf', 'stealable', 'import',
  'request', 'req_count', 'delete',
  'nfparam', 'locator_cyclic', 'locator_replicating',
  'after', 'let', 'for', 'while', 'if',
  'int', 'real', 'string', 'name', 'value'
];

const LUNA_SNIPPETS: { label: string; insertText: vscode.SnippetString; documentation: string }[] = [
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

export function activate(context: vscode.ExtensionContext) {
  const assistant = new LunaAssistantService(context);
  const panel = new AssistantPanel(context, {
    onAsk: async (q) => assistant.ask(q),
    onReindex: async () => assistant.reindexWiki()
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('luna.assistant.open', () => panel.show()),
    vscode.commands.registerCommand('luna.assistant.reindexWiki', () => assistant.reindexWiki()),
    vscode.commands.registerCommand('luna.assistant.toggle', async () => {
      await assistant.toggleEnabled();
      const enabled = await assistant.isEnabled();
      vscode.window.showInformationMessage(`LuNA AI Assistant: ${enabled ? 'enabled' : 'disabled'}.`);
    }),
    vscode.commands.registerCommand('luna.assistant.setApiKey', () => assistant.setApiKeyInteractively())
  );

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
  const selector: vscode.DocumentSelector = [
    { scheme: 'file', language: 'luna' },
    { scheme: 'file', language: 'cpp', pattern: '**/ucodes.cpp' }
  ];

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    selector,
    {
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
    }
  );

  context.subscriptions.push(completionProvider);

  // LSP-клиент для LuNA (.fa)
  const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'luna' },
      { scheme: 'file', language: 'cpp' }   // ← добавили поддержку C++ (ucodes.cpp)
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{fa,cpp}')
    }
  };


  client = new LanguageClient('lunaLanguageServer', 'LuNA Language Server', serverOptions, clientOptions);
  client.start();

  // Предложение создать ucodes.cpp, если его нет рядом с .fa
  const faWatcher = vscode.workspace.createFileSystemWatcher('**/*.fa');
  faWatcher.onDidCreate(uri => checkOrSuggestUcodes(uri));
  faWatcher.onDidChange(uri => checkOrSuggestUcodes(uri));
  context.subscriptions.push(faWatcher);
}

async function checkOrSuggestUcodes(faUri: vscode.Uri) {
  const dir = path.dirname(faUri.fsPath);
  const ucodesPath = path.join(dir, 'ucodes.cpp');
  const ucodesUri = vscode.Uri.file(ucodesPath);

  try {
    await vscode.workspace.fs.stat(ucodesUri);
  } catch {
    const answer = await vscode.window.showInformationMessage(
      'Для LuNA-проекта рядом с .fa обычно есть ucodes.cpp. Создать шаблон ucodes.cpp?',
      'Да',
      'Нет'
    );
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

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
