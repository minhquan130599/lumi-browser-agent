import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeHelperKey, generateFieldText } from '../src/shared/text-helper';
import { DEFAULT_SETTINGS } from '../src/shared/types';

afterEach(() => vi.unstubAllGlobals());

describe('local Text Helper', () => {
  it('supports keyless Ollama on private LAN and preserves the model id', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      textHelper: {
        provider: 'ollama' as const,
        apiKey: '',
        baseUrl: 'http://192.168.142.82:11434/v1',
        model: 'qwen3:8b',
      },
    };
    const mock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{"text":"nhạc thiếu nhi"}' } }] }),
    });
    vi.stubGlobal('fetch', mock);
    expect(describeHelperKey(settings).source).toBe('local');
    const result = await generateFieldText(settings, {
      goal: 'Search for nhạc thiếu nhi',
      field: { label: 'Search' },
      page: { title: 'YouTube', text: 'Search' },
      recent_actions: [],
    });
    expect(result).toBe('nhạc thiếu nhi');
    const [url, opts] = mock.mock.calls[0];
    expect(url).toBe('http://192.168.142.82:11434/v1/chat/completions');
    expect(opts.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(opts.body).model).toBe('qwen3:8b');
  });

  it('never sends an unauthenticated request to a public URL', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      textHelper: {
        provider: 'vllm' as const,
        apiKey: '',
        baseUrl: 'https://example.com/v1',
        model: 'model',
      },
    };
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    await expect(generateFieldText(settings, {
      goal: 'Search', field: { label: 'Search' },
      page: { title: '', text: '' }, recent_actions: [],
    })).rejects.toThrow(/No text is guessed/);
    expect(mock).not.toHaveBeenCalled();
  });
});
