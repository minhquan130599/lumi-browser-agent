import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTaskMemory, rememberTask, sanitizeMemory } from '../src/shared/task-memory';

afterEach(() => vi.unstubAllGlobals());

describe('P1 task memory is temporary and limited', () => {
  it('stores only lightweight per-tab memory in session storage', async () => {
    const db: Record<string, unknown> = {};
    const get = vi.fn(async (key: string) => ({ [key]: db[key] }));
    const set = vi.fn(async (data: Record<string, unknown>) => Object.assign(db, data));
    vi.stubGlobal('chrome', { storage: { session: { get, set } } });
    await rememberTask({
      tabId: 99, host: 'www.youtube.com',
      goal: 'Open https://example.com/?token=secret',
      lastOperation: 'PLAY', outcome: 'done', updatedAt: Date.now(),
    });
    expect((await readTaskMemory(99))?.goal).not.toContain('token=secret');
    expect((await readTaskMemory(98))).toBeNull();
    expect(set).toHaveBeenCalledOnce();
  });
  it('expires records after six hours', async () => {
    const db = { lumi_task_context_v2: [{
      tabId: 7, host: 'example.com', goal: 'test',
      lastOperation: 'CLICK', outcome: 'done', updatedAt: Date.now() - 7 * 60 * 60 * 1000
    }] };
    vi.stubGlobal('chrome', { storage: { session: { get: vi.fn(async () => db) } } });
    expect(await readTaskMemory(7)).toBeNull();
  });
  it('never stores raw URLs in a summary', () => {
    const memory = sanitizeMemory({
      tabId: 1, goal: 'open https://secret.test/?key=ABCDEF',
      host: 'secret.test', outcome: 'done', lastOperation: 'NAVIGATE', updatedAt: 1
    });
    expect(memory.goal).toBe('open [url]');
  });
});
