export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.trunc(concurrency)),
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!, index);
      }
    }),
  );
  return results;
}
