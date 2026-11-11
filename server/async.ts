/** Runs async mappers with a bounded number of concurrent workers. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

const tails = new Map<string, Promise<unknown>>();

/** Serializes work that targets the same key (project, npm prefix, …). */
export async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);

  try {
    return await current;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
