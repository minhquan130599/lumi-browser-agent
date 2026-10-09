import { JevRequest, JevResponse, TypeSafeConfig } from '../types';
import { postJson, INTERACTIVE_JEV_HTTP } from './http';

export async function callTypeSafe(
  config: TypeSafeConfig,
  request: JevRequest,
  signal?: AbortSignal,
  fast = false
): Promise<JevResponse> {
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('TypeSafe API Key is not configured. Please set it in Options.');
  }

  const endpoint = config.endpoint || 'https://api.typesafe.ai/v1/systemone';
  const model = (config.model || '').trim() || 'jev-latest';

  const json = await postJson(
    endpoint,
    { Authorization: `Bearer ${apiKey}` },
    { model, state: request.state, questions: request.questions },
    { label: 'TypeSafe API', ...(fast ? INTERACTIVE_JEV_HTTP : {}), signal }
  );
  return json as JevResponse;
}
