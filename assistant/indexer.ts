import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { YandexAiStudioClient } from './yandexClient';
import { IndexFile, IndexedChunk, saveIndex } from './vectorIndex';

type ChunkPlan = {
  sourcePath: string; // relative to wiki root
  heading: string | null;
  text: string;
};

export type KnowledgeBaseDocument = {
  id: string;
  title: string;
  content: string;
  sourcePath?: string;
};

export async function buildWikiIndex(params: {
  wikiRootAbs: string;
  indexAbsPath: string;
  docEmbeddingModelUri: string;
  chunkChars: number;
  client: YandexAiStudioClient;
  cancellationToken?: vscode.CancellationToken;
  progress?: vscode.Progress<{ message?: string; increment?: number }>;
}): Promise<IndexFile> {
  const mdFiles = await collectMarkdownFiles(params.wikiRootAbs);
  const plans: ChunkPlan[] = [];

  for (const abs of mdFiles) {
    const rel = normalizeRel(path.relative(params.wikiRootAbs, abs));
    const raw = await fs.readFile(abs, 'utf8');
    const docPlans = chunkMarkdown(raw, params.chunkChars).map(p => ({ ...p, sourcePath: rel }));
    plans.push(...docPlans);
  }

  const chunks: IndexedChunk[] = [];
  const total = plans.length;
  let done = 0;

  for (const plan of plans) {
    if (params.cancellationToken?.isCancellationRequested) {
      throw new Error('Indexing cancelled');
    }
    params.progress?.report({ message: `Embedding: ${plan.sourcePath}`, increment: (1 / Math.max(1, total)) * 100 });

    const embedding = await params.client.embedText(params.docEmbeddingModelUri, plan.text);
    const id = `${plan.sourcePath}::${hashForId(plan.heading ?? '')}::${hashForId(plan.text.slice(0, 256))}`;
    chunks.push({ id, sourcePath: plan.sourcePath, heading: plan.heading, text: plan.text, embedding });
    done++;
  }

  const idx: IndexFile = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    modelUri: params.docEmbeddingModelUri,
    chunkChars: params.chunkChars,
    chunks
  };

  await saveIndex(params.indexAbsPath, idx);
  return idx;
}

export async function buildKnowledgeBaseIndex(params: {
  documents: KnowledgeBaseDocument[];
  indexAbsPath: string;
  docEmbeddingModelUri: string;
  chunkChars: number;
  client: YandexAiStudioClient;
  cancellationToken?: vscode.CancellationToken;
  progress?: vscode.Progress<{ message?: string; increment?: number }>;
}): Promise<IndexFile> {
  const plans: ChunkPlan[] = [];

  for (const doc of params.documents) {
    const sourcePath = doc.sourcePath ?? `kb/${doc.id}`;
    const docPlans = chunkMarkdown(doc.content, params.chunkChars).map(p => ({
      ...p,
      sourcePath,
      heading: p.heading ?? doc.title ?? null
    }));
    plans.push(...docPlans);
  }

  const chunks: IndexedChunk[] = [];
  const total = plans.length;

  for (const plan of plans) {
    if (params.cancellationToken?.isCancellationRequested) {
      throw new Error('Indexing cancelled');
    }
    params.progress?.report({ message: `Embedding: ${plan.sourcePath}`, increment: (1 / Math.max(1, total)) * 100 });

    const embedding = await params.client.embedText(params.docEmbeddingModelUri, plan.text);
    const id = `${plan.sourcePath}::${hashForId(plan.heading ?? '')}::${hashForId(plan.text.slice(0, 256))}`;
    chunks.push({ id, sourcePath: plan.sourcePath, heading: plan.heading, text: plan.text, embedding });
  }

  const idx: IndexFile = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    modelUri: params.docEmbeddingModelUri,
    chunkChars: params.chunkChars,
    chunks
  };

  await saveIndex(params.indexAbsPath, idx);
  return idx;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        await walk(abs);
      } else if (e.isFile()) {
        const low = e.name.toLowerCase();
        if (low.endsWith('.md') || low.endsWith('.markdown')) out.push(abs);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

function normalizeRel(rel: string): string {
  return rel.split(path.sep).join('/');
}

/**
 * Very simple Markdown chunking:
 *  - split by headings (#, ##, ...)
 *  - inside each section, further split by approximate char size
 */
export function chunkMarkdown(md: string, chunkChars: number): Array<{ heading: string | null; text: string }> {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  type Section = { heading: string | null; lines: string[] };
  const sections: Section[] = [];
  let cur: Section = { heading: null, lines: [] };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (cur.lines.length) sections.push(cur);
      cur = { heading: m[2]?.trim() || null, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.length) sections.push(cur);

  const out: Array<{ heading: string | null; text: string }> = [];
  for (const sec of sections) {
    const text = sec.lines.join('\n').trim();
    if (!text) continue;
    if (text.length <= chunkChars) {
      out.push({ heading: sec.heading, text });
      continue;
    }
    // Further split by paragraph boundary.
    const paras = text.split(/\n\n+/g);
    let buf = '';
    for (const p of paras) {
      const next = buf ? `${buf}\n\n${p}` : p;
      if (next.length > chunkChars && buf) {
        out.push({ heading: sec.heading, text: buf.trim() });
        buf = p;
      } else {
        buf = next;
      }
    }
    if (buf.trim()) out.push({ heading: sec.heading, text: buf.trim() });
  }
  return out;
}

function hashForId(s: string): string {
  // Non-cryptographic, stable across runs.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
