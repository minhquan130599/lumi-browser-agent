import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestVisionAction } from '../src/shared/vision';
import type { PageSnapshot } from '../src/shared/types';

const snap: PageSnapshot = {
  url: 'https://example.com/page', title: 'Example',
  text: 'Buttons', w: 1200, h: 700, omitted_actions: 0,
  scroll: { y: 0, height: 700 },
  actions: [
    { id: 'safe1', node: 1, kind: 'click', role: 'button', label: 'Open menu' },
    { id: 'danger1', node: 2, kind: 'click', role: 'button', label: 'Delete account' }
  ],
};
afterEach(() => vi.unstubAllGlobals());
function setup(response: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({
      choices: [{ message: { content: response } }]
    })
  });
  const captureVisibleTab = vi.fn(async () => 'data:image/jpeg;base64,' + 'AAA');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async () => ({ active: true, windowId: 3, url: snap.url })),
      captureVisibleTab
    },
    storage: { local: { get: vi.fn(async () => ({
      lumi_ai: { kind: 'ollama', model: 'vision-model',
        baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }
    })) } }
  });
  return { fetchMock, captureVisibleTab };
}

describe('P2 opt-in screenshot action hint', () => {
  it('only returns a DOM-observed, non-sensitive action with high confidence', async () => {
    const { captureVisibleTab } = setup('{"actionId":"safe1","confidence":0.9,"reason":"visible"}');
    const hint = await suggestVisionAction(7, 'Open menu', snap);
    expect(hint?.action.id).toBe('safe1');
    expect(captureVisibleTab).toHaveBeenCalledOnce();
  });
  it('rejects invented IDs and destructive click labels', async () => {
    setup('{"actionId":"danger1","confidence":0.99}');
    expect(await suggestVisionAction(7, 'Find a menu', snap)).toBeNull();
  });
  it('rejects low-confidence decisions', async () => {
    setup('{"actionId":"safe1","confidence":0.3}');
    expect(await suggestVisionAction(7, 'Open menu', snap)).toBeNull();
  });
  it('only screenshots the active tab and current URL', async () => {
    const { captureVisibleTab } = setup('{"actionId":"safe1","confidence":1}');
    const mismatch = { ...snap, url: 'https://different.example/' };
    expect(await suggestVisionAction(7, 'Open menu', mismatch)).toBeNull();
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });
});
