const TRANSIENT_STATUSES = new Set([429, 503, 529]);

export const INTERACTIVE_JEV_HTTP = { retries: 1, retryDelayMs: 250, timeoutMs: 12000 } as const;

export interface PostJsonOptions {
  retries?: number;
  label?: string;
  /** Entire request, including retries and backoff, must finish within this budget. */
  timeoutMs?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

/** Wait only while a task is active; cancellation must also interrupt retry backoff. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * POSTs JSON and returns the parsed body. Model requests are safe to retry;
 * browser actions are not retried here. An overall deadline prevents an
 * unresponsive provider from leaving the browser agent waiting indefinitely.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: PostJsonOptions = {}
): Promise<any> {
  const retries = options.retries ?? 3;
  const label = options.label || 'Model provider';
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 0;
  const onCancelled = () => controller.abort(options.signal?.reason || new Error('Request cancelled'));
  options.signal?.addEventListener('abort', onCancelled, { once: true });
  if (options.signal?.aborted) onCancelled();

  const timeout = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    : null;

  try {
    const payload = JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: payload,
        });
      } catch (err: any) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (attempt >= retries) {
          throw new Error(`${label} connection failed after ${attempt + 1} attempt(s) (${err?.message || String(err)}); no action executed.`);
        }
        await sleep((options.retryDelayMs ?? 800) * 2 ** attempt, controller.signal);
        continue;
      }

      if (TRANSIENT_STATUSES.has(response.status) && attempt < retries) {
        await response.body?.cancel().catch(() => undefined);
        await sleep((options.retryDelayMs ?? 800) * 2 ** attempt, controller.signal);
        continue;
      }

      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.text()).slice(0, 300);
        } catch {
          // ignore unreadable body
        }
        throw new Error(`${label} error (HTTP ${response.status}) after ${attempt + 1} attempt(s)${detail ? ': ' + detail : ''}`);
      }

      return await response.json();
    }
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onCancelled);
  }
}
