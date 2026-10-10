/** Source of truth for the chat model shared by Lumi and the Text Helper. */
export type AIKind = 'chrome' | 'openai' | 'gemini' | 'ollama' | 'vllm';

export interface AIConfig {
  kind: AIKind;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export const DEFAULT_AI: AIConfig = {
  kind: 'chrome', model: '', baseUrl: '', apiKey: '',
};

export const PRESETS: Record<AIKind, { baseUrl: string; model: string }> = {
  chrome: { baseUrl: '', model: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' },
  vllm: { baseUrl: 'http://127.0.0.1:8000/v1', model: 'your-model-id' },
};

export function normalizeAIConfig(saved: unknown): AIConfig {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_AI };
  const config = saved as Partial<AIConfig>;
  const kind = config.kind && Object.prototype.hasOwnProperty.call(PRESETS, config.kind)
    ? config.kind : DEFAULT_AI.kind;
  return {
    kind,
    model: typeof config.model === 'string' ? config.model : PRESETS[kind].model,
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : PRESETS[kind].baseUrl,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
  };
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '[::1]') return true;
  const parts = h.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

export function isPrivateModelUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return (u.protocol === 'https:' || u.protocol === 'http:') &&
      !u.username && !u.password && !u.search && !u.hash && privateHost(u.hostname);
  } catch {
    return false;
  }
}

/** Only HTTPS on public networks, or loopback/private-LAN HTTP. */
export function isAllowedModelUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return !u.username && !u.password && !u.search && !u.hash &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && privateHost(u.hostname)));
  } catch {
    return false;
  }
}

export function resolveChatModel(config: AIConfig): {
  kind: Exclude<AIKind, 'chrome'>;
  model: string;
  baseUrl: string;
  apiKey: string;
} {
  if (config.kind === 'chrome') throw new Error('Chrome Built-in AI requires the Side Panel bridge.');
  const preset = PRESETS[config.kind];
  const baseUrl = (config.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, '');
  if (!isAllowedModelUrl(baseUrl)) {
    throw new Error('Chỉ cho phép HTTPS hoặc HTTP tới localhost/mạng LAN riêng để gọi model.');
  }
  const apiKey = config.apiKey.trim();
  if (!apiKey && (config.kind === 'openai' || config.kind === 'gemini' ||
      !isPrivateModelUrl(baseUrl))) {
    throw new Error('Chưa có API key của Chat AI. Hãy thiết lập trong Cấu hình AI ở Side Panel.');
  }
  return { kind: config.kind, model: config.model.trim() || preset.model, baseUrl, apiKey };
}
