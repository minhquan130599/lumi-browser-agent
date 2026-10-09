import { afterEach, describe, expect, it, vi } from 'vitest';
import { postJson } from '../src/shared/providers/http';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('interactive provider deadline and cancellation', () => {
  function hangsUntilAborted() {
    return vi.fn((_url: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Fetch aborted')), { once: true });
      })
    );
  }

  it('aborts an unresponsive decision request at the overall deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = hangsUntilAborted();
    vi.stubGlobal('fetch', fetchMock);
    const request = postJson('https://example.com/decision', {}, {}, {
      retries: 1,
      retryDelayMs: 5,
      timeoutMs: 100,
      label: 'Jev test',
    });
    const assertion = expect(request).rejects.toThrow('Jev test timed out after 100ms');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops a network request when the agent is cancelled', async () => {
    const fetchMock = hangsUntilAborted();
    vi.stubGlobal('fetch', fetchMock);
    const owner = new AbortController();
    const request = postJson('https://example.com/decision', {}, {}, {
      signal: owner.signal,
      timeoutMs: 1000,
      retries: 1,
    });
    owner.abort(new Error('Stopped by user'));
    await expect(request).rejects.toThrow('Stopped by user');
  });

  it('retries a transient HTTP response once with fast backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    const request = postJson('https://example.com/decision', {}, {}, {
      retries: 1,
      retryDelayMs: 25,
      timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(25);
    expect(await request).toEqual({ answer: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
