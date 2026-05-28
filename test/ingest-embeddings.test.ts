import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMockEmbeddingClient,
  createOpenAIEmbeddingClient,
  EmbeddingError,
  vectorToPgLiteral,
} from "../core/ingest/embeddings.ts";

test("mock embeddings: deterministic — same input, same vector", async () => {
  const client = createMockEmbeddingClient();
  const a = (await client.embed(["hello world"]))[0];
  const b = (await client.embed(["hello world"]))[0];
  assert.equal(a.length, 1536);
  assert.deepEqual(a, b);
});

test("mock embeddings: different inputs differ; vectors are unit-normalised", async () => {
  const client = createMockEmbeddingClient();
  const [a, b] = await client.embed(["alpha", "beta"]);
  assert.notDeepEqual(a, b);
  const mag = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(mag - 1) < 1e-6, `vector should be unit; got mag=${mag}`);
});

test("mock embeddings: configurable dimension", async () => {
  const client = createMockEmbeddingClient({ dim: 384 });
  const v = (await client.embed(["x"]))[0];
  assert.equal(v.length, 384);
  assert.equal(client.dim, 384);
});

test("mock embeddings: empty input → empty array", async () => {
  const client = createMockEmbeddingClient();
  assert.deepEqual(await client.embed([]), []);
});

test("openai embeddings: posts batch and returns vectors in input order", async () => {
  let captured: { url: string; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    captured = { url, body: JSON.parse(String(init.body)) };
    return new Response(
      JSON.stringify({
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 1 },
          { embedding: [0.7, 0.8, 0.9], index: 0 },
        ],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 6, total_tokens: 6 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const client = createOpenAIEmbeddingClient({
    apiKey: "sk-test",
    fetchImpl,
  });
  const vectors = await client.embed(["alpha", "beta"]);
  assert.deepEqual(vectors[0], [0.7, 0.8, 0.9]); // sorted by .index, not response order
  assert.deepEqual(vectors[1], [0.1, 0.2, 0.3]);
  assert.equal(captured!.url, "https://api.openai.com/v1/embeddings");
  assert.deepEqual((captured!.body as { input: string[] }).input, ["alpha", "beta"]);
});

test("openai embeddings: non-2xx throws EmbeddingError with status + body", async () => {
  const fetchImpl = (async () =>
    new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
  const client = createOpenAIEmbeddingClient({ apiKey: "sk", fetchImpl });
  await assert.rejects(client.embed(["x"]), (err) =>
    err instanceof EmbeddingError && err.status === 429,
  );
});

test("vectorToPgLiteral: handles nulls and arrays", () => {
  assert.equal(vectorToPgLiteral(null), null);
  assert.equal(vectorToPgLiteral([]), null);
  assert.equal(vectorToPgLiteral([1, 2, 3]), "[1,2,3]");
});
