import { JevRequest, JevResponse, TypeSafeConfig } from '../types';
import { postJson, INTERACTIVE_JEV_HTTP } from './http';
import { isLocalSystemOneEndpoint, toLocalSystemOneRequest, isLocalPromptTooLong, type LocalCompactLevel } from './local-systemone';

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

  const levels: LocalCompactLevel[] = isLocal ? [0, 1, 2] : [0];
  // Local inference may include a cold start; the cloud 12-second deadline is
  // too aggressive here (real tev1 samples can exceed it without an error).
  const requestOptions = isLocal
    ? { label: 'Local SystemOne', timeoutMs: 45000, retries: 0 }
    : { label: 'TypeSafe API', ...(fast ? INTERACTIVE_JEV_HTTP : {}) };
  for (const level of levels) {
    const adapted = isLocal ? toLocalSystemOneRequest(request, level) : request;
    try {
      const json = await postJson(
        endpoint,
        apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        { model, state: adapted.state, questions: adapted.questions },
        { ...requestOptions, signal }
      );
      return json as JevResponse;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isLocal && isLocalPromptTooLong(error)) {
        if (level < 2) continue;
        throw new Error(
          'Local Jev model rejected even the smallest prompt (2050-token context limit). ' +
          'Try a shorter task or a model with a larger input context. Details: ' + String(error)
        );
      }
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
  throw new Error('Local SystemOne request failed unexpectedly.');
}
