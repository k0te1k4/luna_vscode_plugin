export type KnowledgeBaseProject = {
  id: string;
  name: string;
  versions: string[];
};

export type KnowledgeBaseArticleSummary = {
  id: string;
  title: string;
  updatedAt?: string;
};

export type KnowledgeBaseArticle = {
  id: string;
  title: string;
  content: string;
  updatedAt?: string;
};

type KnowledgeBaseClientOptions = {
  apiKey: string;
  baseUrl: string;
};

export class KnowledgeBaseClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: KnowledgeBaseClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  }

  async listProjects(): Promise<KnowledgeBaseProject[]> {
    const res = await this.getJson<KnowledgeBaseProject[] | { projects: KnowledgeBaseProject[] }>(
      this.buildUrl('/projects')
    );
    return Array.isArray(res) ? res : res.projects ?? [];
  }

  async listArticles(projectId: string, version: string): Promise<KnowledgeBaseArticleSummary[]> {
    const res = await this.getJson<KnowledgeBaseArticleSummary[] | { articles: KnowledgeBaseArticleSummary[] }>(
      this.buildUrl(`/projects/${encodeURIComponent(projectId)}/articles`, { version })
    );
    return Array.isArray(res) ? res : res.articles ?? [];
  }

  async getArticle(projectId: string, version: string, articleId: string): Promise<KnowledgeBaseArticle> {
    return await this.getJson<KnowledgeBaseArticle>(
      this.buildUrl(`/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(articleId)}`, { version })
    );
  }

  async uploadArticle(projectId: string, version: string, title: string, content: string): Promise<void> {
    await this.postJson(
      this.buildUrl(`/projects/${encodeURIComponent(projectId)}/articles`, { version }),
      { title, content }
    );
  }

  async deleteArticle(projectId: string, version: string, articleId: string): Promise<void> {
    await this.deleteJson(
      this.buildUrl(`/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(articleId)}`, { version })
    );
  }

  private buildUrl(path: string, params?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers()
    });
    if (!res.ok) {
      throw new Error(`Knowledge Base HTTP ${res.status}: ${await safeReadText(res)}`);
    }
    return (await res.json()) as T;
  }

  private async postJson(url: string, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`Knowledge Base HTTP ${res.status}: ${await safeReadText(res)}`);
    }
  }

  private async deleteJson(url: string): Promise<void> {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers()
    });
    if (!res.ok) {
      throw new Error(`Knowledge Base HTTP ${res.status}: ${await safeReadText(res)}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${this.apiKey}`
    };
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no-body>';
  }
}
