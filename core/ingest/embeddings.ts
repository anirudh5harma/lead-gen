import { createHash } from "node:crypto";

/**
 * Embedding client. Pluggable so production points at the chosen provider
 * (OpenAI text-embedding-3-small by default — it matches our pgvector
 * column dimensionality of 1536 and is the cheapest 1536-dim option at
 * ~$0.02/M tokens) while tests use a deterministic mock.
 *
 * DeepSeek doesn't ship a hosted embeddings endpoint, so even though
 * ARCHITECTURE.md prefers DeepSeek for chat-style LLM calls, embeddings
 * use a different provider. This is the one documented exception to
 * "DeepSeek everywhere"; the seam is the EmbeddingClient interface so
 * swapping providers is a single-file change.
 */

export interface EmbeddingClient {
  /** Returns one vector per input text, in input order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Vector dimensionality. Must match the pgvector column dimension. */
  readonly dim: number;
}

// ─── OpenAI adapter (production default) ──────────────────────────────────

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  /** Defaults to text-embedding-3-small (1536 dim). */
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export class EmbeddingError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(`${message} (status ${status}): ${body.slice(0, 300)}`);
    this.name = "EmbeddingError";
    this.status = status;
    this.body = body;
  }
}

export function createOpenAIEmbeddingClient(
  opts: OpenAIEmbeddingOptions,
): EmbeddingClient {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = opts.model ?? "text-embedding-3-small";
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  return {
    dim: 1536,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const response = await fetchImpl(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new EmbeddingError("OpenAI embeddings", response.status, text);
      }
      const json = (await response.json()) as OpenAIEmbedResponse;
      // OpenAI returns data sorted by index, but defensively re-order.
      const out = new Array<number[]>(texts.length);
      for (const row of json.data) {
        out[row.index] = row.embedding;
      }
      return out;
    },
  };
}

// ─── Mock (tests + offline dev) ───────────────────────────────────────────

export interface MockEmbeddingOptions {
  dim?: number;
}

/**
 * Deterministic embedding from a stable hash of the input. Two identical
 * inputs produce identical vectors (so dedup tests work); minor variations
 * produce different-enough vectors that cosine similarity is meaningful.
 *
 * Production never uses this — it's purely a test substitute.
 */
export function createMockEmbeddingClient(
  opts: MockEmbeddingOptions = {},
): EmbeddingClient {
  const dim = opts.dim ?? 1536;
  return {
    dim,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => deterministicVector(t, dim));
    },
  };
}

function deterministicVector(text: string, dim: number): number[] {
  // Build a vector by hashing the text with multiple salts. Normalise to
  // unit length so cosine similarity behaves predictably.
  const v = new Array<number>(dim);
  // Use a sliding hash to vary across dimensions.
  for (let i = 0; i < dim; i++) {
    const h = createHash("sha256").update(`${i}:${text}`).digest();
    // Use first 4 bytes as int32, map to [-1, 1]
    const n = h.readInt32BE(0);
    v[i] = n / 0x7fffffff;
  }
  // Normalise.
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v;
  for (let i = 0; i < dim; i++) v[i] /= mag;
  return v;
}

// ─── pgvector serialisation helper ────────────────────────────────────────

export function vectorToPgLiteral(v: number[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  // pgvector accepts `[1,2,3]` literal — also handled by the existing
  // helper in core/graph/_vector.ts, duplicated here so this module is
  // self-contained.
  return `[${v.join(",")}]`;
}
