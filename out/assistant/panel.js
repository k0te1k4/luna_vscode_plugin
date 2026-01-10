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
exports.AssistantPanel = void 0;
const vscode = __importStar(require("vscode"));
class AssistantPanel {
    constructor(context, cb) {
        this.context = context;
        this.cb = cb;
    }
    show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        this.panel = vscode.window.createWebviewPanel('lunaAssistant', 'LuNA AI Assistant (Knowledge Base RAG)', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
        const webview = this.panel.webview;
        webview.html = getHtml();
        webview.onDidReceiveMessage(async (msg) => {
            var _a, _b;
            try {
                if ((msg === null || msg === void 0 ? void 0 : msg.type) === 'ask') {
                    const q = String((_a = msg.question) !== null && _a !== void 0 ? _a : '').trim();
                    if (!q)
                        return;
                    const a = await this.cb.onAsk(q);
                    webview.postMessage({ type: 'answer', answer: a });
                }
                else if ((msg === null || msg === void 0 ? void 0 : msg.type) === 'reindex') {
                    await this.cb.onReindex();
                    webview.postMessage({ type: 'system', text: '✅ Индекс базы знаний обновлён.' });
                }
            }
            catch (e) {
                webview.postMessage({ type: 'error', text: (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e) });
            }
        });
    }
}
exports.AssistantPanel = AssistantPanel;
function getHtml() {
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
    <h1>LuNA AI Assistant (RAG по базе знаний)</h1>
    <button id="reindex">Reindex knowledge base</button>
  </header>
  <div id="log"></div>
  <footer>
    <input id="q" placeholder="Спросите по документации LuNA…" />
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
      add('⏳ Перестраиваю индекс базы знаний…');
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
//# sourceMappingURL=panel.js.map