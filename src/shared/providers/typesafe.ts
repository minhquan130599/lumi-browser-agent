import { JevRequest, JevResponse, TypeSafeConfig } from '../types';
import { postJson, INTERACTIVE_JEV_HTTP } from './http';
import { isLocalSystemOneEndpoint, toLocalSystemOneRequest } from './local-systemone';

export async function callTypeSafe(
  config: TypeSafeConfig,
  request: JevRequest,
  signal?: AbortSignal,
  fast = false
): Promise<JevResponse> {
  const endpoint = config.endpoint || 'https://api.typesafe.ai/v1/systemone';
  const isLocal = isLocalSystemOneEndpoint(endpoint);
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey && !isLocal) {
    throw new Error('TypeSafe API Key is not configured. Please set it in Options.');
  }
  const model = (config.model || '').trim() || 'jev-latest';

  const adapted = isLocal ? toLocalSystemOneRequest(request) : request;
  try {
    const json = await postJson(
      endpoint,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      { model, state: adapted.state, questions: adapted.questions },
      { label: 'TypeSafe API', ...(fast ? INTERACTIVE_JEV_HTTP : {}), signal }
    );
    return json as JevResponse;
  } catch (error) {
    if (isLocal && /HTTP 403/.test(String(error))) {
      const id = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
      const origin = `chrome-extension://${id || '<extension-id>'}`;
      throw new Error(
        `Local SystemOne refused Chrome Origin (HTTP 403). On the Ollama server, set OLLAMA_ORIGINS to ${origin} and restart the Ollama process. ` +
        'Do not disable CORS globally. If already allowed, check server authentication and Origin logs.'
      );
    }
    throw error;
  }
}
