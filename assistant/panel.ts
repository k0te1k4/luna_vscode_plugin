import * as vscode from 'vscode';

export type AssistantPanelCallbacks = {
  onAsk: (question: string) => Promise<string>;
  onReindex: () => Promise<void>;
};

export class AssistantPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly cb: AssistantPanelCallbacks) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'lunaAssistant',
      'LuNA AI Assistant (Wiki RAG)',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    const webview = this.panel.webview;
    webview.html = getHtml();

    webview.onDidReceiveMessage(async msg => {
      try {
        if (msg?.type === 'ask') {
          const q = String(msg.question ?? '').trim();
          if (!q) return;
          const a = await this.cb.onAsk(q);
          webview.postMessage({ type: 'answer', answer: a });
        } else if (msg?.type === 'reindex') {
          await this.cb.onReindex();
          webview.postMessage({ type: 'system', text: '✅ Индекс wiki обновлён.' });
        }
      } catch (e: any) {
        webview.postMessage({ type: 'error', text: e?.message ?? String(e) });
      }
    });
  }
}

function getHtml(): string {
  // Minimal webview UI (no frameworks).
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LuNA Assistant</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif; margin: 0; padding: 0; }
    header { padding: 10px 12px; border-bottom: 1px solid rgba(127,127,127,0.3); display: flex; gap: 8px; align-items: center; }
    header h1 { font-size: 14px; margin: 0; font-weight: 600; flex: 1; }
    button { padding: 6px 10px; font-size: 12px; }
    #log { padding: 12px; height: calc(100vh - 100px); overflow: auto; }
    .msg { margin: 0 0 10px 0; white-space: pre-wrap; line-height: 1.35; }
    .me { font-weight: 600; }
    .err { color: #b00020; }
    footer { padding: 10px 12px; border-top: 1px solid rgba(127,127,127,0.3); display: flex; gap: 8px; }
    input { flex: 1; padding: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <h1>LuNA AI Assistant (RAG по wiki)</h1>
    <button id="reindex">Reindex wiki</button>
  </header>
  <div id="log"></div>
  <footer>
    <input id="q" placeholder="Спросите по LuNA wiki…" />
    <button id="ask">Ask</button>
  </footer>
  <script>
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const q = document.getElementById('q');
    const btn = document.getElementById('ask');
    const reindex = document.getElementById('reindex');

    function add(text, cls) {
      const p = document.createElement('p');
      p.className = 'msg ' + (cls||'');
      p.textContent = text;
      log.appendChild(p);
      log.scrollTop = log.scrollHeight;
    }

    function ask() {
      const question = (q.value || '').trim();
      if (!question) return;
      add('Вы: ' + question, 'me');
      vscode.postMessage({ type: 'ask', question });
      q.value = '';
    }

    btn.addEventListener('click', ask);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
    reindex.addEventListener('click', () => {
      add('⏳ Перестраиваю индекс wiki…');
      vscode.postMessage({ type: 'reindex' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'answer') add('Ассистент: ' + msg.answer);
      if (msg?.type === 'system') add(msg.text);
      if (msg?.type === 'error') add('Ошибка: ' + msg.text, 'err');
    });

    add('Подсказка: если ассистент выключен, включите настройку luna.assistant.enabled и задайте API key командой “LuNA: Set Yandex API Key”.');
  </script>
</body>
</html>`;
}
