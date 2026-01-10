import * as vscode from 'vscode';

export type AssistantPanelCallbacks = {
  onAsk: (question: string) => Promise<string>;
  onReindex: () => Promise<void>;
  onGetKnowledgeState: () => Promise<KnowledgeBaseState>;
  onSetKnowledgeProject: (projectId: string, version: string) => Promise<void>;
  onGetKnowledgeArticle: (articleId: string) => Promise<KnowledgeBaseArticle>;
  onUploadKnowledgeArticle: (title: string, content: string) => Promise<void>;
  onDeleteKnowledgeArticle: (articleId: string) => Promise<void>;
  onPickKnowledgeArticleFile: () => Promise<{ title: string; content: string } | undefined>;
};

type KnowledgeBaseState = {
  enabled: boolean;
  projects: Array<{ id: string; name: string; versions: string[] }>;
  selectedProjectId: string;
  selectedVersion: string;
  articles: Array<{ id: string; title: string; updatedAt?: string }>;
  message?: string;
};

type KnowledgeBaseArticle = {
  id: string;
  title: string;
  content: string;
  updatedAt?: string;
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
        } else if (msg?.type === 'kbRefresh') {
          await this.refreshKnowledgeBase(webview);
        } else if (msg?.type === 'kbSetProject') {
          await this.cb.onSetKnowledgeProject(String(msg.projectId || ''), String(msg.version || ''));
          await this.refreshKnowledgeBase(webview);
        } else if (msg?.type === 'kbGetArticle') {
          const articleId = String(msg.articleId || '');
          if (!articleId) return;
          const article = await this.cb.onGetKnowledgeArticle(articleId);
          webview.postMessage({ type: 'kbArticle', article });
        } else if (msg?.type === 'kbUpload') {
          const title = String(msg.title || '').trim();
          const content = String(msg.content || '').trim();
          if (!title || !content) return;
          await this.cb.onUploadKnowledgeArticle(title, content);
          webview.postMessage({ type: 'system', text: '✅ Статья загружена.' });
          await this.refreshKnowledgeBase(webview);
        } else if (msg?.type === 'kbDelete') {
          const articleId = String(msg.articleId || '');
          if (!articleId) return;
          await this.cb.onDeleteKnowledgeArticle(articleId);
          webview.postMessage({ type: 'system', text: '🗑️ Статья удалена.' });
          await this.refreshKnowledgeBase(webview);
        } else if (msg?.type === 'kbPickFile') {
          const draft = await this.cb.onPickKnowledgeArticleFile();
          if (draft) {
            webview.postMessage({ type: 'kbDraft', draft });
          }
        }
      } catch (e: any) {
        webview.postMessage({ type: 'error', text: e?.message ?? String(e) });
      }
    });

    void this.refreshKnowledgeBase(webview);
  }

  private async refreshKnowledgeBase(webview: vscode.Webview): Promise<void> {
    const state = await this.cb.onGetKnowledgeState();
    webview.postMessage({ type: 'kbState', state });
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
    #log { padding: 12px; height: 30vh; overflow: auto; border-top: 1px solid rgba(127,127,127,0.2); }
    .msg { margin: 0 0 10px 0; white-space: pre-wrap; line-height: 1.35; }
    .me { font-weight: 600; }
    .err { color: #b00020; }
    footer { padding: 10px 12px; border-top: 1px solid rgba(127,127,127,0.3); display: flex; gap: 8px; }
    input { flex: 1; padding: 8px; font-size: 13px; }
    textarea { width: 100%; min-height: 120px; resize: vertical; font-size: 12px; padding: 8px; }
    select { padding: 6px 8px; font-size: 12px; }
    .section { padding: 12px; border-bottom: 1px solid rgba(127,127,127,0.3); }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .row label { font-size: 12px; color: rgba(127,127,127,0.8); }
    #kb-status { font-size: 12px; margin-top: 6px; color: rgba(127,127,127,0.8); }
    #kb-articles { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    #kb-articles ul { list-style: none; padding: 0; margin: 0; max-height: 240px; overflow: auto; border: 1px solid rgba(127,127,127,0.2); }
    #kb-articles li { padding: 6px 8px; border-bottom: 1px solid rgba(127,127,127,0.1); display: flex; justify-content: space-between; gap: 6px; }
    #kb-articles li:last-child { border-bottom: none; }
    .kb-article-title { font-size: 12px; }
    .kb-actions { display: flex; gap: 6px; }
    .small-btn { padding: 2px 6px; font-size: 11px; }
  </style>
</head>
<body>
  <header>
    <h1>LuNA Assistant</h1>
    <button id="reindex">Reindex wiki</button>
  </header>
  <section class="section" id="kb">
    <div class="row">
      <label for="project">Проект</label>
      <select id="project"></select>
      <label for="version">Версия</label>
      <select id="version"></select>
      <button id="kb-refresh">Обновить</button>
    </div>
    <div id="kb-status"></div>
    <div id="kb-articles">
      <div>
        <strong>Статьи</strong>
        <ul id="article-list"></ul>
      </div>
      <div>
        <strong>Просмотр</strong>
        <textarea id="article-view" readonly placeholder="Выберите статью, чтобы посмотреть содержание."></textarea>
      </div>
    </div>
    <div style="margin-top:12px;">
      <strong>Загрузка статьи</strong>
      <input id="article-title" placeholder="Заголовок статьи" />
      <textarea id="article-content" placeholder="Markdown/текст статьи..."></textarea>
      <div class="row">
        <button id="kb-pick-file">Загрузить файл</button>
        <button id="kb-upload">Сохранить в облаке</button>
      </div>
    </div>
  </section>
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
    const projectSelect = document.getElementById('project');
    const versionSelect = document.getElementById('version');
    const kbRefresh = document.getElementById('kb-refresh');
    const kbStatus = document.getElementById('kb-status');
    const articleList = document.getElementById('article-list');
    const articleView = document.getElementById('article-view');
    const articleTitle = document.getElementById('article-title');
    const articleContent = document.getElementById('article-content');
    const kbUpload = document.getElementById('kb-upload');
    const kbPickFile = document.getElementById('kb-pick-file');

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

    function clearSelect(select) {
      while (select.firstChild) select.removeChild(select.firstChild);
    }

    function renderProjects(state) {
      clearSelect(projectSelect);
      clearSelect(versionSelect);
      if (!state.enabled) {
        kbStatus.textContent = state.message || 'База знаний недоступна.';
        return;
      }
      kbStatus.textContent = '';
      state.projects.forEach((project) => {
        const opt = document.createElement('option');
        opt.value = project.id;
        opt.textContent = project.name || project.id;
        if (project.id === state.selectedProjectId) opt.selected = true;
        projectSelect.appendChild(opt);
      });
      const selectedProject = state.projects.find(p => p.id === state.selectedProjectId);
      const versions = selectedProject ? selectedProject.versions : [];
      versions.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        if (v === state.selectedVersion) opt.selected = true;
        versionSelect.appendChild(opt);
      });
    }

    function renderArticles(state) {
      articleList.innerHTML = '';
      if (!state.enabled) return;
      state.articles.forEach((article) => {
        const li = document.createElement('li');
        const title = document.createElement('span');
        title.className = 'kb-article-title';
        title.textContent = article.title || article.id;
        const actions = document.createElement('div');
        actions.className = 'kb-actions';
        const viewBtn = document.createElement('button');
        viewBtn.textContent = 'View';
        viewBtn.className = 'small-btn';
        viewBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'kbGetArticle', articleId: article.id });
        });
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'small-btn';
        delBtn.addEventListener('click', () => {
          if (confirm('Удалить статью?')) {
            vscode.postMessage({ type: 'kbDelete', articleId: article.id });
          }
        });
        actions.appendChild(viewBtn);
        actions.appendChild(delBtn);
        li.appendChild(title);
        li.appendChild(actions);
        articleList.appendChild(li);
      });
      if (!state.articles.length) {
        const li = document.createElement('li');
        li.textContent = 'Нет статей.';
        articleList.appendChild(li);
      }
    }

    projectSelect.addEventListener('change', () => {
      const projectId = projectSelect.value;
      const version = versionSelect.value || '';
      vscode.postMessage({ type: 'kbSetProject', projectId, version });
    });

    versionSelect.addEventListener('change', () => {
      const projectId = projectSelect.value;
      const version = versionSelect.value;
      vscode.postMessage({ type: 'kbSetProject', projectId, version });
    });

    kbRefresh.addEventListener('click', () => {
      vscode.postMessage({ type: 'kbRefresh' });
    });

    kbUpload.addEventListener('click', () => {
      vscode.postMessage({
        type: 'kbUpload',
        title: articleTitle.value,
        content: articleContent.value
      });
    });

    kbPickFile.addEventListener('click', () => {
      vscode.postMessage({ type: 'kbPickFile' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'answer') add('Ассистент: ' + msg.answer);
      if (msg?.type === 'system') add(msg.text);
      if (msg?.type === 'error') add('Ошибка: ' + msg.text, 'err');
      if (msg?.type === 'kbState') {
        renderProjects(msg.state);
        renderArticles(msg.state);
      }
      if (msg?.type === 'kbArticle') {
        const article = msg.article;
        articleView.value = article ? article.content : '';
      }
      if (msg?.type === 'kbDraft') {
        const draft = msg.draft;
        if (draft) {
          articleTitle.value = draft.title || '';
          articleContent.value = draft.content || '';
        }
      }
    });

    add('Подсказка: если ассистент выключен, включите настройку luna.assistant.enabled и задайте API key командой “LuNA: Set Yandex API Key”.');
  </script>
</body>
</html>`;
}
