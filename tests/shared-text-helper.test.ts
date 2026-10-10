import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI, normalizeAIConfig, resolveChatModel } from '../src/shared/ai-config';
import type { AIConfig } from '../src/shared/ai-config';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/types';
import { describeHelperKey, generateFieldText } from '../src/shared/text-helper';

const field = {
  goal: 'Find flights to Da Nang',
  field: { label: 'Destination', role: 'textbox' },
  page: { title: 'Flights', text: 'Flights from Hanoi to Da Nang' },
  recent_actions: [],
};
const good = (text: string) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ text }) } }] }),
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Text Helper shares Chat AI by default', () => {
  it('preserves custom settings across migration', () => {
    expect(DEFAULT_SETTINGS.textHelperMode).toBe('shared');
    expect(mergeSettings(null).textHelperMode).toBe('shared');
    expect(mergeSettings({ textHelper: { ...DEFAULT_SETTINGS.textHelper } }).textHelperMode).toBe('shared');
    const old = mergeSettings({
      textHelper: { provider: 'ollama', model: 'qwen3:8b', baseUrl: 'http://192.168.1.4:11434/v1', apiKey: '' },
    });
    expect(old.textHelperMode).toBe('custom');
    expect(old.textHelper.model).toBe('qwen3:8b');
    expect(mergeSettings({ textHelperMode: 'shared', textHelper: old.textHelper }).textHelperMode).toBe('shared');
  });

  it('inherits Gemini model, endpoint and the same key', async () => {
    const config: AIConfig = {
      kind: 'gemini', model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '[REDACTED_SECRET]',
    };
    const mock = vi.fn().mockResolvedValue(good('Da Nang'));
    vi.stubGlobal('fetch', mock);
    expect(describeHelperKey(DEFAULT_SETTINGS, config).source).toBe('shared');
    expect(await generateFieldText(DEFAULT_SETTINGS, field, config)).toBe('Da Nang');
    const [url, opts] = mock.mock.calls[0];
    expect(url).toBe(config.baseUrl + '/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer [REDACTED_SECRET]');
    expect(JSON.parse(opts.body).model).toBe(config.model);
  });

  it('reads the current Chat AI from chrome.storage.local on each call', async () => {
    const ai: AIConfig = {
      kind: 'openai', model: 'gpt-4.1-mini',
      baseUrl: 'https://api.openai.com/v1', apiKey: '[REDACTED_SECRET]',
    };
    const storage = { get: vi.fn().mockResolvedValue({ lumi_ai: ai }) };
    vi.stubGlobal('chrome', { storage: { local: storage } });
    const mock = vi.fn().mockResolvedValue(good('Da Nang'));
    vi.stubGlobal('fetch', mock);
    expect(await generateFieldText(DEFAULT_SETTINGS, field)).toBe('Da Nang');
    expect(storage.get).toHaveBeenCalledWith(['lumi_ai']);
    expect(mock.mock.calls[0][1].headers.Authorization).toBe('Bearer [REDACTED_SECRET]');
  });

  it.each(['ollama', 'vllm'] as const)('reuses local %s without a key', async kind => {
    const ai: AIConfig = {
      kind, model: 'qwen3:8b', baseUrl: 'http://192.168.142.82:11434/v1', apiKey: '',
    };
    const mock = vi.fn().mockResolvedValue(good('Da Nang'));
    vi.stubGlobal('fetch', mock);
    expect(await generateFieldText(DEFAULT_SETTINGS, field, ai)).toBe('Da Nang');
    expect(mock.mock.calls[0][0]).toBe(ai.baseUrl + '/chat/completions');
    expect(mock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('does not call unauthenticated public HTTP endpoints', async () => {
    const mock = vi.fn(); vi.stubGlobal('fetch', mock);
    await expect(generateFieldText(DEFAULT_SETTINGS, field, {
      kind: 'ollama', model: 'remote', baseUrl: 'http://example.com/v1', apiKey: '',
    })).rejects.toThrow(/TYPE_TEXT cannot run/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('requires a selected cloud key rather than reusing another provider key', async () => {
    await expect(generateFieldText(DEFAULT_SETTINGS, field, {
      kind: 'gemini', model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '',
    })).rejects.toThrow(/Chưa có API key/);
  });

  it('bridges Chrome Built-in AI to Side Panel without a key', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true, text: '{"text":"Da Nang"}' });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    expect(describeHelperKey(DEFAULT_SETTINGS, DEFAULT_AI).source).toBe('chrome');
    expect(await generateFieldText(DEFAULT_SETTINGS, field, DEFAULT_AI)).toBe('Da Nang');
    const message = sendMessage.mock.calls[0][0];
    expect(message.type).toBe('LUMI_CHROME_TEXT_HELPER');
    expect(message.context.goal).toBe(field.goal);
    expect(message).not.toHaveProperty('apiKey');
  });

  it('rejects unsupported Chrome text and missing panel', async () => {
    vi.stubGlobal('chrome', { runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true, text: 'Type anything' }),
    } });
    await expect(generateFieldText(DEFAULT_SETTINGS, field, DEFAULT_AI)).rejects.toThrow(/JSON/);
    vi.stubGlobal('chrome', { runtime: {
      sendMessage: vi.fn().mockRejectedValue(new Error('Receiving end does not exist')),
    } });
    await expect(generateFieldText(DEFAULT_SETTINGS, field, DEFAULT_AI)).rejects.toThrow(/Receiving end does not exist/);
  });

  it('preserves an independently configured Text Helper', async () => {
    const settings = {
      ...DEFAULT_SETTINGS, textHelperMode: 'custom' as const,
      textHelper: { provider: 'ollama' as const, model: 'separate-qwen',
        baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' },
    };
    const chat: AIConfig = {
      kind: 'openai', model: 'different-cloud',
      baseUrl: 'https://api.openai.com/v1', apiKey: '[REDACTED_SECRET]',
    };
    const mock = vi.fn().mockResolvedValue(good('Da Nang'));
    vi.stubGlobal('fetch', mock);
    expect(await generateFieldText(settings, field, chat)).toBe('Da Nang');
    expect(mock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(mock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('normalizes invalid storage and forbids public HTTP', () => {
    expect(normalizeAIConfig({ kind: 'unknown' }).kind).toBe('chrome');
    expect(() => resolveChatModel({
      kind: 'openai', model: 'x', baseUrl: 'http://example.com/v1', apiKey: '[REDACTED_SECRET]',
    })).toThrow(/HTTPS/);
  });
});
