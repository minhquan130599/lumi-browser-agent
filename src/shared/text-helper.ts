import { parseFieldText } from 'jev-dev-kit';
import { TEXT_VALUE_PROMPT } from './prompts';
import { OPENROUTER_HEADERS } from './providers/openrouter';
import { postJson } from './providers/http';
import { DEFAULT_AI, normalizeAIConfig, resolveChatModel, isPrivateModelUrl } from './ai-config';
import type { AIConfig } from './ai-config';
import { AppSettings, PageAction, RecentAction, TEXT_HELPER_PRESETS } from './types';

export { parseFieldText };

export interface FieldContext {
  goal: string;
  field: {
    label?: string;
    role?: string;
    value?: string;
  };
  page: {
    title: string;
    text: string;
  };
  recent_actions: Array<Pick<RecentAction, 'action' | 'text'>>;
}

export function createFieldContext(
  goal: string,
  action: PageAction,
  page: { title: string; text: string },
  history: RecentAction[]
): FieldContext {
  return {
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    page: { title: page.title, text: page.text.slice(0, 6000) },
    recent_actions: history.slice(-6).map(h => ({ action: h.action, text: h.text })),
  };
}

export interface HelperKeyStatus {
  provider: string;
  baseUrl: string;
  model: string;
  source: 'helper' | 'openrouter' | 'local' | 'shared' | 'chrome' | null;
  message: string;
}

function customHelperStatus(settings: AppSettings): HelperKeyStatus {
  const cfg = settings.textHelper;
  const preset = TEXT_HELPER_PRESETS[cfg.provider] || TEXT_HELPER_PRESETS.openrouter;
  const baseUrl = ((cfg.baseUrl || '').trim() || preset.baseUrl).replace(/\/+$/, '');
  const model = (cfg.model || '').trim() || preset.model;
  const own = (cfg.apiKey || '').trim();
  const openrouterKey = (settings.openrouter.apiKey || '').trim();
  const viaOpenRouter = baseUrl.includes('openrouter.ai');
  if (own) return {
    provider: cfg.provider, baseUrl, model, source: 'helper',
    message: `Text helper uses its own key for ${model} at ${baseUrl}.`,
  };
  if (viaOpenRouter && openrouterKey) return {
    provider: cfg.provider, baseUrl, model, source: 'openrouter',
    message: `Text helper reuses the OpenRouter key for ${model}.`,
  };
  if (isPrivateModelUrl(baseUrl)) return {
    provider: cfg.provider, baseUrl, model, source: 'local',
    message: `Using local model ${model} at ${baseUrl} without an API key.`,
  };
  const hint = viaOpenRouter
    ? 'Enter an OpenRouter key in the Jev provider section or in the Text helper section.'
    : `The text helper is set to "${cfg.provider}" (${baseUrl}); the OpenRouter key is only shared for OpenRouter. Enter a key for that provider, or switch the helper provider back to OpenRouter (Reset to defaults does this).`;
  return {
    provider: cfg.provider, baseUrl, model, source: null,
    message: `No API key for the text helper. ${hint}`,
  };
}

/** Describes the effective model without revealing the API key in UI/logs. */
export function describeHelperKey(
  settings: AppSettings,
  chatConfig: AIConfig = DEFAULT_AI
): HelperKeyStatus {
  if (settings.textHelperMode === 'custom') return customHelperStatus(settings);

  const ai = normalizeAIConfig(chatConfig);
  if (ai.kind === 'chrome') return {
    provider: 'chrome', baseUrl: '', model: 'Chrome Built-in AI', source: 'chrome',
    message: 'Text Helper kế thừa Chrome Built-in AI; giữ Side Panel Lumi đang mở khi Agent chạy. Không cần API key.',
  };
  try {
    const model = resolveChatModel(ai);
    return {
      provider: model.kind, baseUrl: model.baseUrl, model: model.model, source: 'shared',
      message: `Text Helper đang dùng chung ${model.kind.toUpperCase()} / ${model.model} từ Chat AI. Không cần nhập key lần nữa.`,
    };
  } catch (error) {
    return {
      provider: ai.kind, baseUrl: ai.baseUrl, model: ai.model, source: null,
      message: `Cấu hình Chat AI chưa sẵn sàng: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function storedChatConfig(): Promise<AIConfig> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return { ...DEFAULT_AI };
  const result = await chrome.storage.local.get(['lumi_ai']);
  return normalizeAIConfig(result.lumi_ai);
}

async function generateChromeFieldText(context: FieldContext): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome Built-in AI cần Side Panel Lumi đang mở để sinh nội dung nhập liệu.');
  }
  // Limit content transferred to the on-device Prompt API and keep instructions
  // ahead of untrusted page text; never ask the page to execute a script.
  const brief: FieldContext = {
    goal: context.goal.slice(0, 450),
    field: context.field,
    page: {
      title: context.page.title.slice(0, 150),
      text: context.page.text.slice(0, 2100),
    },
    recent_actions: context.recent_actions.slice(-3),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: 'LUMI_CHROME_TEXT_HELPER', context: brief }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          'Chrome Built-in AI chưa trả lời. Hãy giữ Side Panel Lumi đang mở hoặc chọn model Chat AI khác.'
        )), 210000);
      }),
    ]);
    if (!response?.success || typeof response.text !== 'string') {
      throw new Error(response?.error ||
        'Chrome Built-in AI chưa phản hồi. Hãy mở Side Panel Lumi, sau đó thử lại.');
    }
    return parseFieldText(response.text);
  } catch (error) {
    throw new Error('Chrome Text Helper: ' +
      (error instanceof Error ? error.message : String(error)));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Uses the Side Panel Chat model by default. Advanced users may switch to a
 * separate helper in Jev Settings. No value is guessed if the response is invalid.
 *
 * chatConfig is optional for unit tests; at runtime the shared config is read
 * fresh from chrome.storage.local on each TYPE_TEXT action.
 */
export async function generateFieldText(
  settings: AppSettings,
  context: FieldContext,
  chatConfig?: AIConfig
): Promise<string> {
  const shared = settings.textHelperMode !== 'custom';
  const ai = shared ? normalizeAIConfig(chatConfig ?? await storedChatConfig()) : undefined;
  const status = describeHelperKey(settings, ai);
  if (shared && ai?.kind === 'chrome') return generateChromeFieldText(context);

  if (!status.source) {
    throw new Error(`TYPE_TEXT cannot run: ${status.message} No text is guessed by the executor.`);
  }

  const { baseUrl, model } = status;
  let apiKey = '';
  if (shared) {
    apiKey = resolveChatModel(ai!).apiKey;
  } else {
    apiKey = status.source === 'helper'
      ? (settings.textHelper.apiKey || '').trim()
      : status.source === 'openrouter'
        ? (settings.openrouter.apiKey || '').trim() : '';
  }

  const isOpenRouter = baseUrl.includes('openrouter.ai');
  const isDeepSeek = baseUrl.includes('api.deepseek.com');
  const payload: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TEXT_VALUE_PROMPT },
      { role: 'user', content: JSON.stringify(context) },
    ],
    ...(isDeepSeek ? { thinking: { type: 'disabled' } } : {}),
  };
  const json = await postJson(
    `${baseUrl}/chat/completions`,
    { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(isOpenRouter ? OPENROUTER_HEADERS : {}) },
    payload,
    { label: 'Text helper' }
  );
  const rawContent = json?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('Text helper returned an empty message; nothing typed.');
  }
  return parseFieldText(rawContent);
}
