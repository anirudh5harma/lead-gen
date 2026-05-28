/**
 * Generates a 1536-dim embedding vector using OpenAI text-embedding-3-small.
 * Cheap: ~$0.02 per 1M tokens.
 */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000), // token safety cap
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Embedding API error: ${res.status} ${body}`)
  }

  const json = await res.json()
  return json.data[0].embedding as number[]
}

/** Formats a float[] as a Postgres vector literal: '[0.1,0.2,...]' */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
