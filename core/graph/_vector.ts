/**
 * pgvector glue. pgvector accepts a vector either as a JS array (`'[1,2,3]'`
 * literal string) or via the `pgvector` adapter package. We use the literal
 * string form to avoid pulling another dependency for foundation.
 *
 * The expected dimensionality is 1536 (text-embedding-3-small / Voyage etc.);
 * callers are expected to pass that. We don't enforce here — the DB does
 * via the column type — but we DO sanity-check that values are finite.
 */

export function formatVector(v: number[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  for (const x of v) {
    if (!Number.isFinite(x)) {
      throw new Error("vector contains non-finite values");
    }
  }
  return `[${v.join(",")}]`;
}
