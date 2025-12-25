import * as vscode from 'vscode';

export type YandexClientOptions = {
  /** Stored in VS Code Secret Storage. */
  apiKey: string;
};

export type CompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  text: string;
};

export class YandexAiStudioClient {
  private readonly apiKey: string;

  constructor(opts: YandexClientOptions) {
    this.apiKey = opts.apiKey;
  }

  private async postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // AI Studio auth: Authorization: Api-Key <API_key>
        // https://yandex.cloud/en/docs/ai-studio/api-ref/authentication
        Authorization: `Api-Key ${this.apiKey}`
      },
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
   */
  async embedText(modelUri: string, text: string, signal?: AbortSignal): Promise<number[]> {
    const r = await this.postJson<{ embedding: string[] | number[] }>(
      'https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding',
      { modelUri, text },
      signal
    );
    // API doc says "string" but actual values are numeric; normalize.
    return (r.embedding as any[]).map(v => (typeof v === 'string' ? Number(v) : v));
  }

  /**
   * Text generation API (sync): POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion
   */
  async completion(modelUri: string, messages: CompletionMessage[], maxTokens = 1024, temperature = 0.2, signal?: AbortSignal): Promise<string> {
    const r = await this.postJson<any>(
      'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
      {
        modelUri,
        completionOptions: {
          stream: false,
          temperature,
          maxTokens: String(maxTokens)
        },
        messages
      },
      signal
    );

    // Response format: result.alternatives[0].message.text is common.
    const text: string | undefined = r?.result?.alternatives?.[0]?.message?.text;
    if (!text) {
      throw new Error(`Unexpected completion response shape: ${JSON.stringify(r).slice(0, 500)}`);
    }
    return text;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no-body>';
  }
}

/**
 * Helper: stored under a stable secret key name.
 */
export async function getApiKeyFromSecrets(context: vscode.ExtensionContext): Promise<string | undefined> {
  return await context.secrets.get('luna.assistant.yandexApiKey');
}

export async function setApiKeyInSecrets(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store('luna.assistant.yandexApiKey', apiKey);
}
