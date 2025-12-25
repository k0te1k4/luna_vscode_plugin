import * as path from 'path';
import * as vscode from 'vscode';
import { buildWikiIndex } from './indexer';
import { getAssistantConfig, withDerivedDefaults } from './config';
import { getApiKeyFromSecrets, setApiKeyInSecrets, YandexAiStudioClient } from './yandexClient';
import { loadIndex, topKBySimilarity } from './vectorIndex';

export class LunaAssistantService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async isEnabled(): Promise<boolean> {
    const cfg = getAssistantConfig();
    return cfg.enabled;
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
    if (!baseCfg.enabled) {
      throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
    }
    if (!baseCfg.docEmbeddingModelUri) {
      throw new Error('Не задан luna.assistant.docEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
    }
    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) {
      throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');
    }

    const wikiRootAbs = path.join(ws, baseCfg.wikiSubmodulePath);
    const indexAbsPath = path.join(ws, baseCfg.indexStoragePath);

    const client = new YandexAiStudioClient({ apiKey });
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LuNA Assistant: индексация wiki',
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

    vscode.window.showInformationMessage('LuNA Assistant: индекс wiki готов.');
  }

  async ask(question: string): Promise<string> {
    const ws = getWorkspaceRoot();
    if (!ws) throw new Error('Откройте папку (workspace) в VS Code.');
    const baseCfg = withDerivedDefaults(getAssistantConfig());
    if (!baseCfg.enabled) {
      throw new Error('Ассистент выключен. Включите настройку luna.assistant.enabled.');
    }

    const apiKey = await getApiKeyFromSecrets(this.context);
    if (!apiKey) throw new Error('API key не задан. Запустите команду “LuNA: Set Yandex API Key”.');

    if (!baseCfg.queryEmbeddingModelUri) {
      throw new Error('Не задан luna.assistant.queryEmbeddingModelUri (или luna.assistant.yandexFolderId для автоподстановки).');
    }
    if (!baseCfg.generationModelUri) {
      throw new Error('Не задан luna.assistant.generationModelUri.');
    }

    const indexAbsPath = path.join(ws, baseCfg.indexStoragePath);
    const idx = await loadIndex(indexAbsPath);
    if (!idx) {
      throw new Error('Индекс не найден. Выполните “LuNA: Reindex Wiki for Assistant”.');
    }

    const client = new YandexAiStudioClient({ apiKey });
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

    const answer = await client.completion(
      baseCfg.generationModelUri,
      [
        { role: 'system', text: system },
        { role: 'user', text: user }
      ],
      1400,
      0.2
    );

    return answer;
  }
}

function getWorkspaceRoot(): string | undefined {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return ws;
}
