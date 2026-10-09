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

  it('falls back to an English-configured session for Vietnamese prompts', async () => {
    const destroy = vi.fn();
    const create = vi.fn().mockResolvedValue({
      prompt: vi.fn().mockResolvedValue('Đây là tóm tắt.'),
      destroy,
    });
    const availability = vi.fn()
      .mockResolvedValueOnce('unavailable') // Vietnamese isn't advertised
      .mockResolvedValueOnce('available'); // English model is ready
    const onStatus = vi.fn();
    vi.stubGlobal('LanguageModel', { availability, create });

    const answer = await askAI(
      DEFAULT_AI,
      [{ role: 'user', content: 'Tóm tắt trang web hiện tại' }],
      { onStatus }
    );
    expect(answer).toBe('Đây là tóm tắt.');
    expect(availability).toHaveBeenNthCalledWith(1, {
      expectedInputs: [{ type: 'text', languages: ['vi'] }],
      expectedOutputs: [{ type: 'text', languages: ['vi'] }],
    });
    expect(availability).toHaveBeenNthCalledWith(2, {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    }));
    expect(onStatus.mock.calls.flat().join(' ')).toContain('chế độ tương thích');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('uses Vietnamese directly when availability advertises it', async () => {
    const create = vi.fn().mockResolvedValue({
      prompt: vi.fn().mockResolvedValue('Xin chào'),
      destroy: vi.fn(),
    });
    const availability = vi.fn().mockResolvedValue('available');
    vi.stubGlobal('LanguageModel', { availability, create });
    expect(await askAI(DEFAULT_AI, [{ role: 'user', content: 'Xin chào' }])).toBe('Xin chào');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      expectedInputs: [{ type: 'text', languages: ['vi'] }],
      expectedOutputs: [{ type: 'text', languages: ['vi'] }],
    }));
    expect(availability).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable only after checking both languages', async () => {
    const create = vi.fn();
    const availability = vi.fn().mockResolvedValue('unavailable');
    vi.stubGlobal('LanguageModel', { availability, create });
    await expect(
      askAI(DEFAULT_AI, [{ role: 'user', content: 'Tóm tắt trang web hiện tại' }])
    ).rejects.toThrow(/ngay cả với cấu hình tiếng Anh/);
    expect(availability).toHaveBeenCalledTimes(2);
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
