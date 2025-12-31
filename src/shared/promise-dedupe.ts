const promiseCache = new Map<string, Promise<any>>();

export function dedupePromise<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  if (!cacheKey) {
    return fn();
  }

  if (promiseCache.has(cacheKey)) {
    return promiseCache.get(cacheKey) as Promise<T>;
  }

  const promise = fn().finally(() => {
    promiseCache.delete(cacheKey);
  });

  promiseCache.set(cacheKey, promise);
  return promise;
}
