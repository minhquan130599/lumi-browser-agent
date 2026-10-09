import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAI, checkChromeAI, DEFAULT_AI, withDeadline } from '../src/sidepanel/ai';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Chrome Built-in AI integration', () => {
  it('explains when the Chrome Prompt API is missing', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    expect(await checkChromeAI()).toContain('chưa');
    await expect(
      askAI(DEFAULT_AI, [{ role: 'user', content: 'Summarize' }])
    ).rejects.toThrow('Không tìm thấy Chrome Prompt API');
  });

  it('rejects unsupported Vietnamese without starting the session', async () => {
    const create = vi.fn();
    const availability = vi.fn().mockResolvedValue('unavailable');
    vi.stubGlobal('LanguageModel', { availability, create });

    await expect(
      askAI(DEFAULT_AI, [{ role: 'user', content: 'Tóm tắt trang web hiện tại' }])
    ).rejects.toThrow(/không hỗ trợ yêu cầu tiếng Việt/);

    expect(availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['vi'] }],
      expectedOutputs: [{ type: 'text', languages: ['vi'] }],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports download progress and streams the result', async () => {
    const destroy = vi.fn();
    const onStatus = vi.fn();
    const onPartial = vi.fn();
    const create = vi.fn().mockImplementation(async (options: {
      monitor: (m: {
        addEventListener: (type: string, cb: (e: { loaded: number }) => void) => void;
      }) => void;
    }) => {
      options.monitor({
        addEventListener: (_type, callback) => callback({ loaded: 0.45 }),
      });
      return {
        promptStreaming: async function* () {
          yield 'This ';
          yield 'is a summary.';
        },
        destroy,
      };
    });
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('downloadable'),
      create,
    });

    const result = await askAI(
      DEFAULT_AI,
      [{ role: 'user', content: 'Summarize this page' }],
      { onStatus, onPartial }
    );

    expect(result).toBe('This is a summary.');
    expect(onStatus.mock.calls.flat().join(' ')).toContain('45%');
    expect(onPartial).toHaveBeenLastCalledWith('This is a summary.');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('stops waiting and reports a timeout', async () => {
    vi.useFakeTimers();
    const pending = withDeadline(
      async () => new Promise<string>(() => undefined),
      1100,
      undefined,
      'Model'
    );
    const assertion = expect(pending).rejects.toThrow(/Model quá 2 giây/);
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it('allows the user to cancel a waiting request', async () => {
    const controller = new AbortController();
    const pending = withDeadline(
      async () => new Promise<string>(() => undefined),
      60_000,
      controller.signal
    );
    controller.abort(new Error('User cancelled'));
    await expect(pending).rejects.toThrow('User cancelled');
  });
});
