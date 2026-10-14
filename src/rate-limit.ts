export async function withBackoff<T>(operation: () => Promise<T>, options: { attempts?: number; delayMs?: number; timeoutMs?: number } = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 1000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('request_timeout')), options.timeoutMs ?? 15000); }),
      ]);
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
      if ((status !== 429 && (status < 500 || status > 599)) || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * 2 ** attempt));
    } finally { clearTimeout(timer); }
  }
  throw new Error('retry_exhausted');
}
