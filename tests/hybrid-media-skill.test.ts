import { afterEach, describe, expect, it, vi } from 'vitest';
import { runYoutubeMediaSkill } from '../src/background/media-skill';
import { routeDirectIntent } from '../src/shared/intent-router';

afterEach(() => vi.unstubAllGlobals());

describe('P0 YouTube media fast path, no Jev needed', () => {
  const first = 'https://www.youtube.com/watch?v=first';
  const next = routeDirectIntent('chuyển bài tiếp', first)!;
  const input = {
    attachedTab: null, attach: vi.fn(async () => false),
    click: vi.fn(), youtubeShortcut: vi.fn(),
  } as any;

  it('clicks observed YouTube next control and verifies a new playing video', async () => {
    let url = first;
    let playing = true;
    const sendMessage = vi.fn(async (_id: number, message: any) => {
      if (message.type === 'CONTENT_MEDIA_STATUS') return { found: true, playing };
      if (message.type === 'CONTENT_MEDIA_CONTROL_TARGET') return { found: true, safe: true, x: 20, y: 20 };
      if (message.type === 'CONTENT_MEDIA_CONTROL_CLICK') {
        url = 'https://www.youtube.com/watch?v=second';
        playing = true;
        return { success: true };
      }
      return undefined;
    });
    vi.stubGlobal('chrome', { tabs: { get: vi.fn(async () => ({ url })), sendMessage } });
    const result = await runYoutubeMediaSkill(7, next, input, false,
      () => false, async () => undefined);
    expect(result.ok).toBe(true);
    expect(result.beforeId).toBe('first');
    expect(result.afterId).toBe('second');
    expect(sendMessage.mock.calls.some(([, msg]: any) => msg.type === 'CONTENT_MEDIA_CONTROL_CLICK')).toBe(true);
  });

  it('returns blocked instead of false DONE when URL never changes', async () => {
    vi.stubGlobal('chrome', { tabs: {
      get: vi.fn(async () => ({ url: first })),
      sendMessage: vi.fn(async (_id: number, msg: any) =>
        msg.type === 'CONTENT_MEDIA_STATUS' ? { found: true, playing: true } :
          msg.type === 'CONTENT_MEDIA_CONTROL_TARGET' ? { found: true, safe: true, x: 3, y: 6 } :
            { success: true }),
    } });
    const result = await runYoutubeMediaSkill(7, next, input, false,
      () => false, async () => undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not change');
  });

  it('never sends a click when no safe player control or trusted shortcut is available', async () => {
    const messages: string[] = [];
    vi.stubGlobal('chrome', { tabs: {
      get: vi.fn(async () => ({ url: first })),
      sendMessage: vi.fn(async (_id: number, msg: any) => {
        messages.push(msg.type);
        return msg.type === 'CONTENT_MEDIA_STATUS' ? { found: true, playing: true } :
          { found: false, safe: false };
      }),
    } });
    const result = await runYoutubeMediaSkill(7, next, input, false,
      () => false, async () => undefined);
    expect(result.ok).toBe(false);
    expect(messages).not.toContain('CONTENT_MEDIA_CONTROL_CLICK');
  });
});
