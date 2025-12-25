import * as vscode from 'vscode';

export type YandexClientOptions = {
  /** Stored in VS Code Secret Storage. */
  apiKey: string;

  /**
   * Optional folderId used for endpoints / headers and for deriving model strings.
   * For embeddings you can pass modelUri like emb://<folderId>/...
   * For chat you can pass model like gpt://<folderId>/<modelId>/latest
   */
  folderId?: string;
};

export type CompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  text: string;
};

type ChatCompletionsMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export class YandexAiStudioClient {
  private readonly apiKey: string;
  private readonly folderId?: string;

  constructor(opts: YandexClientOptions) {
    this.apiKey = opts.apiKey;
    this.folderId = opts.folderId;
  }

  private async postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Yandex Cloud AI Studio auth
      Authorization: `Api-Key ${this.apiKey}`
    };

    // For many YC AI endpoints, x-folder-id is either required or helps routing.
    // Safe to send when folderId is known.
    if (this.folderId) headers['x-folder-id'] = this.folderId;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      const txt = await safeReadText(res);
      throw new Error(`Yandex AI Studio HTTP ${res.status}: ${txt}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Embeddings API: POST https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding
   * modelUri example: emb://<folderId>/text-search-doc/latest
   */
  async embedText(modelUri: string, text: string, signal?: AbortSignal): Promise<number[]> {
    const r = await this.postJson<{ embedding: string[] | number[] }>(
      'https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding',
      { modelUri, text },
      signal
    );
    return (r.embedding as any[]).map(v => (typeof v === 'string' ? Number(v) : v));
  }

  /**
   * Chat Completions API (OpenAI-compatible):
   * POST https://llm.api.cloud.yandex.net/v1/chat/completions
   *
   * model should be like: gpt://<folderId>/<modelId>/latest
   */
  async completion(
    model: string,
    messages: CompletionMessage[],
    maxTokens = 1024,
    temperature = 0.2,
    signal?: AbortSignal
  ): Promise<string> {
    const resolvedModel = this.resolveChatModel(model);

    const chatMessages: ChatCompletionsMessage[] = messages.map(m => ({
      role: m.role,
      content: m.text
    }));

    const r = await this.postJson<any>(
      'https://llm.api.cloud.yandex.net/v1/chat/completions',
      {
        model: resolvedModel,
        temperature,
        max_tokens: maxTokens,
        messages: chatMessages
      },
      signal
    );

    const text: string | undefined = r?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error(`Unexpected chat.completions response shape: ${JSON.stringify(r).slice(0, 700)}`);
    }
    return text;
  }

  /**
   * Accepts:
   *  - full "gpt://<folderId>/<modelId>/latest"
   *  - or "<modelId>" (if folderId exists): "yandexgpt" / "yandexgpt-lite"
   */
  private resolveChatModel(model: string): string {
    const m = (model || '').trim();
    if (!m) throw new Error('generationModelUri/model is empty');

    // Common misconfigs:
    if (m.startsWith('emb://')) {
      throw new Error(
        `Invalid generation model "${m}". It looks like embeddings modelUri (emb://...). ` +
        `For chat use: gpt://<folderId>/<modelId>/latest (e.g. gpt://${this.folderId ?? '<folderId>'}/yandexgpt-lite/latest)`
      );
    }
    if (m.startsWith('http://') || m.startsWith('https://')) {
      throw new Error(
        `Invalid generation model "${m}". Do not pass URL here. ` +
        `Use: gpt://<folderId>/<modelId>/latest (e.g. gpt://${this.folderId ?? '<folderId>'}/yandexgpt-lite/latest)`
      );
    }

    if (m.startsWith('gpt://')) return m;

    if (this.folderId) return `gpt://${this.folderId}/${m}/latest`;

    throw new Error(
      `Invalid chat model: "${model}". Expected "gpt://<folderId>/<modelId>/latest" or provide folderId.`
    );
  }

}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no-body>';
  }
}

export async function getApiKeyFromSecrets(context: vscode.ExtensionContext): Promise<string | undefined> {
  return await context.secrets.get('luna.assistant.yandexApiKey');
}

export async function setApiKeyInSecrets(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store('luna.assistant.yandexApiKey', apiKey);
}
