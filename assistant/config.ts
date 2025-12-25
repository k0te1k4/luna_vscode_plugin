import * as vscode from 'vscode';

export type AssistantConfig = {
  enabled: boolean;
  wikiSubmodulePath: string;
  indexStoragePath: string;
  yandexFolderId: string;
  docEmbeddingModelUri: string;
  queryEmbeddingModelUri: string;
  generationModelUri: string;
  topK: number;
  chunkChars: number;
};

export function getAssistantConfig(): AssistantConfig {
  const cfg = vscode.workspace.getConfiguration('luna');
  return {
    enabled: cfg.get<boolean>('assistant.enabled', false),
    wikiSubmodulePath: cfg.get<string>('assistant.wikiSubmodulePath', 'luna.wiki'),
    indexStoragePath: cfg.get<string>('assistant.indexStoragePath', '.luna/assistant/index.json'),
    yandexFolderId: cfg.get<string>('assistant.yandexFolderId', ''),
    docEmbeddingModelUri: cfg.get<string>('assistant.docEmbeddingModelUri', ''),
    queryEmbeddingModelUri: cfg.get<string>('assistant.queryEmbeddingModelUri', ''),
    generationModelUri: cfg.get<string>('assistant.generationModelUri', ''),
    topK: clamp(cfg.get<number>('assistant.topK', 5), 1, 20),
    chunkChars: clamp(cfg.get<number>('assistant.chunkChars', 1800), 300, 8000)
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * If user didn't fill explicit model URIs but did fill folderId, we can derive defaults.
 *
 * Per Yandex AI Studio docs:
 *  - emb://<folder_ID>/text-search-doc/latest
 *  - emb://<folder_ID>/text-search-query/latest
 */
export function withDerivedDefaults(cfg: AssistantConfig): AssistantConfig {
  if (!cfg.yandexFolderId) return cfg;
  return {
    ...cfg,
    docEmbeddingModelUri: cfg.docEmbeddingModelUri || `emb://${cfg.yandexFolderId}/text-search-doc/latest`,
    queryEmbeddingModelUri: cfg.queryEmbeddingModelUri || `emb://${cfg.yandexFolderId}/text-search-query/latest`
  };
}
