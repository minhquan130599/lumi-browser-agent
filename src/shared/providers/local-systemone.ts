import type { JevQuestion, JevQuestions, JevRequest } from '../types';

/**
 * SystemOne adapters on an Ollama/LAN server may require Choice.criteria values
 * to be strings/null and 2..26 options. Remote TypeSafe/OpenRouter retain their
 * original richer request; this conversion is only used for self-hosted endpoints.
 */
export function isLocalSystemOneEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (!/\/v1\/systemone\/?$/.test(url.pathname)) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const groups = /^172\.(\d+)\./.exec(host);
    return Boolean(groups && Number(groups[1]) >= 16 && Number(groups[1]) <= 31);
  } catch {
    return false;
  }
}

function description(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 550);
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => k === 'element' ? String(v) : k + ': ' + String(v))
      .join('; ')
      .slice(0, 550);
  }
  return String(value).slice(0, 550);
}

function usefulWords(value: string): string[] {
  return value.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3);
}

function bestCandidateKeys(choices: Array<[string, unknown]>, task: string): Set<string> {
  const goals = usefulWords(task);
  const ranked = choices.map(([key, value], index) => {
    const words = usefulWords(description(value) || '');
    const score = goals.reduce((sum, word) => {
      const canonical = word.endsWith('s') ? word.slice(0, -1) : word;
      return sum + (words.some(w => w === word || w.startsWith(canonical)) ? 1 : 0);
    }, 0);
    return { key, index, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return new Set(ranked.slice(0, 26).map(entry => entry.key));
}

export function toLocalSystemOneRequest(input: JevRequest): JevRequest {
  const state = input.state as { task?: string } | string;
  const task = typeof state === 'string' ? state : state.task || '';
  const questions: Record<string, JevQuestion> = {};

  for (const [name, question] of Object.entries(input.questions)) {
    if (question.type !== 'choice') {
      questions[name] = question;
      continue;
    }

    const choices = Object.entries(question.criteria);
    if (choices.length === 1 && name.endsWith('_target')) {
      // No need to ask a decision model to choose the only valid target.
      // The browser runtime selects the sole action directly.
      continue;
    }

    const accepted = choices.length <= 26
      ? new Set(choices.map(([key]) => key))
      : bestCandidateKeys(choices, task);
    const criteria = Object.fromEntries(
      choices.filter(([key]) => accepted.has(key))
        .map(([key, value]) => [key, description(value)])
    );
    questions[name] = { ...question, criteria };
  }
  return { ...input, questions: questions as JevQuestions };
}
