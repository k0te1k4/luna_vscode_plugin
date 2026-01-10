import * as path from 'path';
import * as vscode from 'vscode';
import { buildKnowledgeBaseIndex, buildWikiIndex, KnowledgeBaseDocument } from './indexer';
import { getAssistantConfig, withDerivedDefaults } from './config';
import { KnowledgeBaseArticle, KnowledgeBaseArticleSummary, KnowledgeBaseClient, KnowledgeBaseProject } from './knowledgeBaseClient';
import { getApiKeyFromSecrets, setApiKeyInSecrets, YandexAiStudioClient } from './yandexClient';
import { loadIndex, topKBySimilarity } from './vectorIndex';

export class LunaAssistantService {
  private output?: vscode.OutputChannel;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async isEnabled(): Promise<boolean> {
    return getAssistantConfig().enabled;
  }

  async toggleEnabled(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('luna');
    const cur = cfg.get<boolean>('assistant.enabled', false);
    await cfg.update('assistant.enabled', !cur, vscode.ConfigurationTarget.Workspace);
  }

  async setApiKeyInteractively(): Promise<void> {
    const key = await vscode.window.showInputBox({
      prompt: 'Введите Yandex Cloud AI Studio API key (будет сохранён в Secret Storage VS Code)',
      password: true,
      ignoreFocusOut: true
    });
    if (!key) return;
    await setApiKeyInSecrets(this.context, key.trim());
    vscode.window.showInformationMessage('API key сохранён.');
  }

  async reindexWiki(): Promise<void> {
    const ws = getWorkspaceRoot();
    if (!ws) throw new Error('Откройте папку (workspace) в VS Code.');

    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.enabled) throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
    if (!baseCfg.docEmbeddingModelUri) {
      throw new Error('Не задан luna.assistant.docEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
    }

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');

    const { projectId, version } = this.getSelectedKnowledgeBase(baseCfg);
    const indexAbsPath = this.resolveIndexPath(ws, baseCfg, projectId, version);

    // Передаём folderId (если задан) — это важно для x-folder-id
    const client = new YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LuNA Assistant: индексация wiki',
        cancellable: true
      },
      async (progress, token) => {
        if (baseCfg.knowledgeBaseApiBaseUrl) {
          const documents = await this.fetchKnowledgeBaseDocuments(baseCfg, apiKey);
          await buildKnowledgeBaseIndex({
            documents,
            indexAbsPath,
            docEmbeddingModelUri: baseCfg.docEmbeddingModelUri,
            chunkChars: baseCfg.chunkChars,
            client,
            cancellationToken: token,
            progress
          });
        } else {
          const wikiRootAbs = path.join(ws, baseCfg.wikiSubmodulePath);
          await buildWikiIndex({
            wikiRootAbs,
            indexAbsPath,
            docEmbeddingModelUri: baseCfg.docEmbeddingModelUri,
            chunkChars: baseCfg.chunkChars,
            client,
            cancellationToken: token,
            progress
          });
        }
      }
    );

    vscode.window.showInformationMessage('LuNA Assistant: индекс wiki готов.');
  }

  async ask(question: string): Promise<string> {
    const ws = getWorkspaceRoot();
    if (!ws) throw new Error('Откройте папку (workspace) в VS Code.');

    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.enabled) throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');

    if (!baseCfg.queryEmbeddingModelUri) {
      throw new Error('Не задан luna.assistant.queryEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
    }
    if (!baseCfg.generationModelUri) {
      throw new Error('Не задан luna.assistant.generationModelUri (например gpt://<folderId>/yandexgpt-lite/latest).');
    }

    const { projectId, version } = this.getSelectedKnowledgeBase(baseCfg);
    const indexAbsPath = this.resolveIndexPath(ws, baseCfg, projectId, version);
    const idx = await loadIndex(indexAbsPath);
    if (!idx) throw new Error('Индекс не найден. Выполните “LuNA: Reindex Wiki for Assistant”.');

    const client = new YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });

    const qEmb = await client.embedText(baseCfg.queryEmbeddingModelUri, question);
    const top = topKBySimilarity(qEmb, idx.chunks, baseCfg.topK);

    const contextBlocks = top
      .map((t, i) => {
        const head = t.chunk.heading ? ` — ${t.chunk.heading}` : '';
        return `[#${i + 1}] ${t.chunk.sourcePath}${head}\n${t.chunk.text}`;
      })
      .join('\n\n');

    const system =
      'Ты — технический ассистент по языку LuNA. Отвечай ТОЛЬКО на основе переданного контекста wiki. ' +
      'Если в контексте нет ответа, честно скажи, что в wiki этого нет, и предложи, какой файл/раздел стоит дополнить.';

    const user =
      `Контекст (фрагменты wiki):\n\n${contextBlocks}\n\n` +
      `Вопрос: ${question}\n\n` +
      'Сформулируй ответ по-русски. Если используешь факты, укажи ссылки на номера фрагментов [#1], [#2], ...';

    return await client.completion(
      baseCfg.generationModelUri,
      [
        { role: 'system', text: system },
        { role: 'user', text: user }
      ],
      1400,
      0.2
    );
  }

  async explainSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Нет активного редактора.');

    const doc = editor.document;
    if (!isExplainSupported(doc)) {
      throw new Error('Explain поддерживается только для файлов .fa и .cpp/.h/.hpp.');
    }

    const sel = editor.selection;
    const selected = sel && !sel.isEmpty ? doc.getText(sel) : '';
    if (!selected.trim()) throw new Error('Нужно выделить фрагмент кода для объяснения.');

    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.enabled) throw new Error('Ассистент выключен. Включите luna.assistant.enabled.');

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');

    if (!baseCfg.generationModelUri) {
      throw new Error('Не задан luna.assistant.generationModelUri. Пример: gpt://<folderId>/yandexgpt-lite/latest');
    }

    const code = clampTextByChars(selected, baseCfg.codeExplainMaxChars || 16000);

    const filePath = vscode.workspace.asRelativePath(doc.uri, false);
    const language = doc.languageId;
    const rangeStr = `L${sel.start.line + 1}:${sel.start.character + 1}–L${sel.end.line + 1}:${sel.end.character + 1}`;

    const system =
      'Ты — ассистент разработчика. Объясняй код понятно и по делу. ' +
      'Если видишь проблемы/ошибки — перечисли их отдельно. ' +
      'Если можно улучшить — предложи конкретные варианты. ' +
      'Если не хватает контекста — скажи, что именно нужно.';

    const user =
      `Задача: объясни выделенный фрагмент кода.\n` +
      `Файл: ${filePath}\n` +
      `Диапазон: ${rangeStr}\n` +
      `Язык/тип: ${language}\n\n` +
      `Код:\n` +
      '```' +
      guessFence(language, filePath) +
      '\n' +
      code +
      '\n```';

    const client = new YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });

    const answer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'LuNA: Explain selection', cancellable: true },
      async (_progress, token) => {
        const signal = abortSignalFromCancellationToken(token);
        return await client.completion(
          baseCfg.generationModelUri,
          [
            { role: 'system', text: system },
            { role: 'user', text: user }
          ],
          1200,
          0.2,
          signal
        );
      }
    );

    this.getOutput().appendLine(`--- Explain Selection: ${filePath} (${rangeStr}) ---`);
    this.getOutput().appendLine(answer.trim());
    this.getOutput().appendLine('');
    this.getOutput().show(true);
  }

  async explainFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Нет активного редактора.');

    const doc = editor.document;
    if (!isExplainSupported(doc)) {
      throw new Error('Explain поддерживается только для файлов .fa и .cpp/.h/.hpp.');
    }

    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.enabled) throw new Error('Ассистент выключен. Включите luna.assistant.enabled.');

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');

    if (!baseCfg.generationModelUri) {
      throw new Error('Не задан luna.assistant.generationModelUri. Пример: gpt://<folderId>/yandexgpt-lite/latest');
    }

    const filePath = vscode.workspace.asRelativePath(doc.uri, false);
    const language = doc.languageId;

    const code = clampTextByChars(doc.getText(), baseCfg.codeExplainMaxChars || 16000);

    const system =
      'Ты — ассистент разработчика. Объясни файл: назначение, структура, важные функции/классы, ' +
      'как это работает, типичные ошибки и места для улучшений. ' +
      'Если файл слишком большой и обрезан — скажи, чего не хватает.';

    const user =
      `Задача: объясни файл целиком.\n` +
      `Файл: ${filePath}\n` +
      `Язык/тип: ${language}\n\n` +
      `Код:\n` +
      '```' +
      guessFence(language, filePath) +
      '\n' +
      code +
      '\n```';

    const client = new YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });

    const answer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'LuNA: Explain file', cancellable: true },
      async (_progress, token) => {
        const signal = abortSignalFromCancellationToken(token);
        return await client.completion(
          baseCfg.generationModelUri,
          [
            { role: 'system', text: system },
            { role: 'user', text: user }
          ],
          1400,
          0.2,
          signal
        );
      }
    );

    this.getOutput().appendLine(`--- Explain File: ${filePath} ---`);
    this.getOutput().appendLine(answer.trim());
    this.getOutput().appendLine('');
    this.getOutput().show(true);
  }

  async getKnowledgeBaseState(): Promise<{
    enabled: boolean;
    projects: KnowledgeBaseProject[];
    selectedProjectId: string;
    selectedVersion: string;
    articles: KnowledgeBaseArticleSummary[];
    message?: string;
  }> {
    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.knowledgeBaseApiBaseUrl) {
      return {
        enabled: false,
        projects: [],
        selectedProjectId: baseCfg.knowledgeBaseProjectId,
        selectedVersion: baseCfg.knowledgeBaseProjectVersion,
        articles: [],
        message: 'Настройте luna.assistant.knowledgeBase.apiBaseUrl, чтобы включить облачную базу знаний.'
      };
    }

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) {
      return {
        enabled: false,
        projects: [],
        selectedProjectId: baseCfg.knowledgeBaseProjectId,
        selectedVersion: baseCfg.knowledgeBaseProjectVersion,
        articles: [],
        message: 'API key не задан. Запустите команду “LuNA: Set Yandex API Key”.'
      };
    }

    const kbClient = new KnowledgeBaseClient({ apiKey, baseUrl: baseCfg.knowledgeBaseApiBaseUrl });
    const projects = await kbClient.listProjects();
    const selectedProjectId = baseCfg.knowledgeBaseProjectId || projects[0]?.id || '';
    const selectedVersion =
      baseCfg.knowledgeBaseProjectVersion || projects.find(p => p.id === selectedProjectId)?.versions?.[0] || '';

    if ((!baseCfg.knowledgeBaseProjectId && selectedProjectId) || (!baseCfg.knowledgeBaseProjectVersion && selectedVersion)) {
      const cfg = vscode.workspace.getConfiguration('luna');
      if (selectedProjectId && !baseCfg.knowledgeBaseProjectId) {
        await cfg.update('assistant.knowledgeBase.projectId', selectedProjectId, vscode.ConfigurationTarget.Workspace);
      }
      if (selectedVersion && !baseCfg.knowledgeBaseProjectVersion) {
        await cfg.update('assistant.knowledgeBase.projectVersion', selectedVersion, vscode.ConfigurationTarget.Workspace);
      }
    }

    let articles: KnowledgeBaseArticleSummary[] = [];
    if (selectedProjectId && selectedVersion) {
      articles = await kbClient.listArticles(selectedProjectId, selectedVersion);
    }

    return {
      enabled: true,
      projects,
      selectedProjectId,
      selectedVersion,
      articles
    };
  }

  async setKnowledgeBaseSelection(projectId: string, version: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('luna');
    await cfg.update('assistant.knowledgeBase.projectId', projectId, vscode.ConfigurationTarget.Workspace);
    await cfg.update('assistant.knowledgeBase.projectVersion', version, vscode.ConfigurationTarget.Workspace);
  }

  async getKnowledgeBaseArticle(articleId: string): Promise<KnowledgeBaseArticle> {
    const baseCfg = withDerivedDefaults(getAssistantConfig());
    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
    if (!baseCfg.knowledgeBaseApiBaseUrl) throw new Error('Не задан luna.assistant.knowledgeBase.apiBaseUrl.');

    const { projectId, version } = this.getSelectedKnowledgeBase(baseCfg);
    const kbClient = new KnowledgeBaseClient({ apiKey, baseUrl: baseCfg.knowledgeBaseApiBaseUrl });
    return await kbClient.getArticle(projectId, version, articleId);
  }

  async uploadKnowledgeBaseArticle(title: string, content: string): Promise<void> {
    const baseCfg = withDerivedDefaults(getAssistantConfig());
    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
    if (!baseCfg.knowledgeBaseApiBaseUrl) throw new Error('Не задан luna.assistant.knowledgeBase.apiBaseUrl.');

    const { projectId, version } = this.getSelectedKnowledgeBase(baseCfg);
    const kbClient = new KnowledgeBaseClient({ apiKey, baseUrl: baseCfg.knowledgeBaseApiBaseUrl });
    await kbClient.uploadArticle(projectId, version, title, content);
  }

  async deleteKnowledgeBaseArticle(articleId: string): Promise<void> {
    const baseCfg = withDerivedDefaults(getAssistantConfig());
    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
    if (!baseCfg.knowledgeBaseApiBaseUrl) throw new Error('Не задан luna.assistant.knowledgeBase.apiBaseUrl.');

    const { projectId, version } = this.getSelectedKnowledgeBase(baseCfg);
    const kbClient = new KnowledgeBaseClient({ apiKey, baseUrl: baseCfg.knowledgeBaseApiBaseUrl });
    await kbClient.deleteArticle(projectId, version, articleId);
  }

  async pickKnowledgeBaseArticleFile(): Promise<{ title: string; content: string } | undefined> {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        Markdown: ['md', 'markdown'],
        Text: ['txt']
      },
      openLabel: 'Загрузить статью'
    });
    if (!result?.length) return undefined;
    const fileUri = result[0];
    const raw = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(raw).toString('utf8');
    const title = path.basename(fileUri.fsPath).replace(/\.(md|markdown|txt)$/i, '');
    return { title, content };
  }

  private getOutput(): vscode.OutputChannel {
    if (!this.output) {
      this.output = vscode.window.createOutputChannel('LuNA Assistant');
    }
    return this.output;
  }

  private resolveIndexPath(
    wsRoot: string,
    cfg: ReturnType<typeof getAssistantConfig>,
    projectId?: string,
    version?: string
  ): string {
    if (cfg.indexStoragePath) {
      return path.join(wsRoot, cfg.indexStoragePath);
    }
    const storageBase =
      this.context.globalStorageUri?.fsPath || this.context.storageUri?.fsPath || path.join(wsRoot, '.luna');
    const safeProject = projectId || 'default-project';
    const safeVersion = version || 'default-version';
    return path.join(storageBase, 'assistant', safeProject, safeVersion, 'index.json');
  }

  private getSelectedKnowledgeBase(cfg: ReturnType<typeof getAssistantConfig>): { projectId: string; version: string } {
    if (cfg.knowledgeBaseApiBaseUrl) {
      const projectId = cfg.knowledgeBaseProjectId;
      const version = cfg.knowledgeBaseProjectVersion;
      if (!projectId || !version) {
        throw new Error('Выберите проект и версию базы знаний в панели LuNA Assistant.');
      }
      return { projectId, version };
    }
    return { projectId: '', version: '' };
  }

  private async fetchKnowledgeBaseDocuments(cfg: ReturnType<typeof getAssistantConfig>, apiKey: string): Promise<KnowledgeBaseDocument[]> {
    if (!cfg.knowledgeBaseApiBaseUrl) return [];
    const { projectId, version } = this.getSelectedKnowledgeBase(cfg);
    const kbClient = new KnowledgeBaseClient({ apiKey, baseUrl: cfg.knowledgeBaseApiBaseUrl });
    const summaries = await kbClient.listArticles(projectId, version);
    const docs: KnowledgeBaseDocument[] = [];

    for (const summary of summaries) {
      const article = await kbClient.getArticle(projectId, version, summary.id);
      docs.push({
        id: summary.id,
        title: article.title || summary.title,
        content: article.content,
        sourcePath: `kb/${projectId}/${version}/${summary.id}`
      });
    }
    return docs;
  }
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function isExplainSupported(doc: vscode.TextDocument): boolean {
  const fsPath = doc.uri.fsPath.toLowerCase();
  if (fsPath.endsWith('.fa')) return true;
  if (fsPath.endsWith('.cpp') || fsPath.endsWith('.cc') || fsPath.endsWith('.cxx')) return true;
  if (fsPath.endsWith('.h') || fsPath.endsWith('.hpp') || fsPath.endsWith('.hh')) return true;
  return false;
}

function clampTextByChars(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `\n\n/* …TRUNCATED: original length ${s.length} chars, limit ${maxChars}… */`;
}

function guessFence(languageId: string, filePath: string): string {
  const fp = filePath.toLowerCase();
  if (fp.endsWith('.fa')) return 'luna';
  if (languageId.includes('cpp') || fp.endsWith('.cpp') || fp.endsWith('.hpp') || fp.endsWith('.h')) return 'cpp';
  return '';
}

/**
 * Convert VS Code CancellationToken -> AbortSignal (for fetch()).
 * Works on Node 18+ (VS Code extension host).
 */
function abortSignalFromCancellationToken(token: vscode.CancellationToken): AbortSignal | undefined {
  if (!token) return undefined;
  const ac = new AbortController();
  if (token.isCancellationRequested) {
    ac.abort();
    return ac.signal;
  }
  token.onCancellationRequested(() => ac.abort());
  return ac.signal;
}
