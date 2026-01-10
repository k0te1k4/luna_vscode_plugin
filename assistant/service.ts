import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { buildWikiIndex } from './indexer';
import { getAssistantConfig, withDerivedDefaults } from './config';
import { getApiKeyFromSecrets, setApiKeyInSecrets, YandexAiStudioClient } from './yandexClient';
import { loadIndex, topKBySimilarity } from './vectorIndex';
import { KnowledgeBaseService } from '../kb/service';

export class LunaAssistantService {
  private output?: vscode.OutputChannel;

  constructor(private readonly context: vscode.ExtensionContext, private readonly kb: KnowledgeBaseService) {}

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
    const folder = this.kb.getActiveFolder();
    if (!folder) throw new Error('Откройте папку (workspace) в VS Code.');

    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.enabled) throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
    if (!baseCfg.docEmbeddingModelUri) {
      throw new Error('Не задан luna.assistant.docEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
    }

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');

    const version = this.kb.getVersionForFolder(folder);
    const indexAbsPath = resolveIndexPath(this.context, folder.uri, baseCfg.indexStorageScope, baseCfg.indexStoragePath, version);

    // Передаём folderId (если задан) — это важно для x-folder-id
    const client = new YandexAiStudioClient({ apiKey, folderId: baseCfg.yandexFolderId || undefined });

    // Sync docs from cloud (Object Storage) into local cache, then build index.
    const wikiRootAbs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `LuNA Assistant: индексация базы знаний (${version})`,
        cancellable: true
      },
      async (progress, token) => {
        await this.kb.syncDocs(version, progress, token);
        // If cloud has no docs for this version yet, fail fast with a helpful message.
        const docsRoot = this.kb.docsCacheRoot(version);
        const mdCount = await countFilesByExt(docsRoot, new Set(['.md', '.markdown', '.txt']));
        if (mdCount === 0) {
          const kbCfg = vscode.workspace.getConfiguration('luna');
          const bucket = kbCfg.get<string>('kb.storage.bucket', '');
          const basePrefix = kbCfg.get<string>('kb.storage.basePrefix', 'luna-kb');
          throw new Error(
            `В облачной базе знаний не найдено документов для версии “${version}”.\n` +
              `Ожидаемый путь: s3://${bucket}/${basePrefix}/${version}/docs/\n` +
              `Загрузите Markdown/TXT через “LuNA KB: Upload Docs Files/Folder” или создайте версию и перенесите файлы в этот префикс.`
          );
        }
        return this.kb.docsCacheRoot(version);
      }
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `LuNA Assistant: embedding + index (${version})`,
        cancellable: true
      },
      async (progress, token) => {
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
    );

    vscode.window.showInformationMessage(`LuNA Assistant: индекс базы знаний готов (${version}).`);
  }

  async ask(question: string): Promise<string> {
    const folder = this.kb.getActiveFolder();
    if (!folder) throw new Error('Откройте папку (workspace) в VS Code.');

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

    const version = this.kb.getVersionForFolder(folder);
    const indexAbsPath = resolveIndexPath(this.context, folder.uri, baseCfg.indexStorageScope, baseCfg.indexStoragePath, version);
    const idx = await loadIndex(indexAbsPath);
    if (!idx) throw new Error('Индекс не найден. Выполните “LuNA: Reindex Knowledge Base for Assistant”.');

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
      'Ты — технический ассистент по языку LuNA. Отвечай ТОЛЬКО на основе переданного контекста базы знаний. ' +
      'Если в контексте нет ответа, честно скажи, что в базе знаний этого нет, и предложи, какой файл/раздел стоит дополнить.';

    const user =
      `Контекст (фрагменты базы знаний):\n\n${contextBlocks}\n\n` +
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

  private getOutput(): vscode.OutputChannel {
    if (!this.output) {
      this.output = vscode.window.createOutputChannel('LuNA Assistant');
    }
    return this.output;
  }
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function resolveIndexPath(
  context: vscode.ExtensionContext,
  folderUri: vscode.Uri,
  scope: 'global' | 'workspace',
  relPath: string,
  version: string
): string {
  const base = scope === 'workspace' ? folderUri.fsPath : context.globalStorageUri.fsPath;
  const cleaned = String(relPath || 'assistant/index.json').replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = path.dirname(cleaned);
  const file = path.basename(cleaned);
  return path.join(base, dir, version, file);
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

async function countFilesByExt(rootAbs: string, exts: Set<string>): Promise<number> {
  try {
    const st = await fs.stat(rootAbs);
    if (!st.isDirectory()) return 0;
  } catch {
    return 0;
  }

  let count = 0;
  const stack: string[] = [rootAbs];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true } as any);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (exts.has(ext)) count++;
      }
    }
  }
  return count;
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
