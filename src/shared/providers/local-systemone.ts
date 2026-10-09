import type { JevQuestion, JevQuestions, JevRequest, ObservedElement } from '../types';

/**
 * Local SystemOne on small models (including tev1) can have a ~2050-token
 * prompt cap. The upstream Jev request contains long, repeated instructions
 * and a 6000-character page excerpt; reduce ONLY self-hosted requests.
 */
export type LocalCompactLevel = 0 | 1 | 2;

interface Budget {
  goalChars: number;
  pageChars: number;
  targetCandidates: number;
  targetDescriptionChars: number;
  stateElements: number;
  elementLabelChars: number;
  historyCount: number;
  warningChars: number;
}

const BUDGETS: Record<LocalCompactLevel, Budget> = {
  0: { goalChars: 280, pageChars: 700, targetCandidates: 10,
    targetDescriptionChars: 110, stateElements: 12, elementLabelChars: 85,
    historyCount: 3, warningChars: 120 },
  1: { goalChars: 210, pageChars: 300, targetCandidates: 7,
    targetDescriptionChars: 75, stateElements: 8, elementLabelChars: 65,
    historyCount: 2, warningChars: 90 },
  2: { goalChars: 145, pageChars: 95, targetCandidates: 4,
    targetDescriptionChars: 48, stateElements: 5, elementLabelChars: 50,
    historyCount: 1, warningChars: 60 },
};

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

const clip = (value: unknown, limit: number): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase();
}

function words(value: string): string[] {
  return normalize(value).split(/[^a-z0-9]+/).filter(word => word.length >= 3);
}

function description(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => k === 'element' ? String(v) : k + ': ' + String(v))
      .join('; ');
  }
  return String(value);
}

/** Prioritize names and routes matching the goal (e.g. voice -> /v1/voices). */
function relevance(label: string, goal: string): number {
  const targetWords = words(label);
  const goalWords = new Set(words(goal));
  let score = 0;
  for (const term of goalWords) {
    const stem = term.endsWith('s') ? term.slice(0, -1) : term;
    if (targetWords.some(word => word === term || word.startsWith(stem))) score += 3;
  }
  if (/\b(get|try it out|execute|search|submit)\b/i.test(label) &&
      /\b(api|test|lay|tim|search|get)\b/.test(normalize(goal))) score++;
  return score;
}

function bestCandidateKeys(
  choices: Array<[string, unknown]>,
  task: string,
  limit: number
): Set<string> {
  const ranked = choices.map(([key, value], index) => ({
    key, index, score: relevance(description(value), task),
  }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  // Preserve at least two real candidates for non-trivial choice questions.
  return new Set(ranked.slice(0, Math.max(2, limit)).map(entry => entry.key));
}

/** Keep the page heading plus short windows surrounding relevant task terms. */
function relevantPageText(text: string, task: string, limit: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= limit) return cleaned;
  const start = cleaned.slice(0, Math.min(100, Math.floor(limit / 3)));
  const normalizedText = normalize(cleaned);
  const terms = [...new Set(words(task))].sort((a, b) => b.length - a.length);
  const seen = new Set<number>();
  const excerpts: string[] = [start];
  let used = start.length;
  for (const term of terms) {
    if (used >= limit - 40) break;
    const pos = normalizedText.indexOf(term, Math.min(80, normalizedText.length));
    if (pos < 0 || [...seen].some(previous => Math.abs(pos - previous) < 90)) continue;
    seen.add(pos);
    const left = Math.max(0, pos - 40);
    const room = Math.min(150, limit - used - 2);
    const passage = cleaned.slice(left, left + room);
    excerpts.push(passage);
    used += passage.length + 2;
  }
  return excerpts.join(' | ').slice(0, limit);
}

function briefInstructions(name: string, instructions: unknown, limit: number): string {
  const original = instructions && typeof instructions === 'object'
    ? instructions as Record<string, unknown>
    : {};
  const warning = clip(original.ineffective_action_alert ?? original.notice ?? '', limit);
  const base = name === 'operation'
    ? 'Next safe step. Swagger: open matching GET then Try it out/Execute. DONE only if fulfilled; BLOCKED only if no progress.'
    : name.endsWith('_target')
      ? 'Select the most relevant visible control by its index.'
      : name === 'goal_done'
        ? 'Is the user goal already visibly complete?'
        : name === 'stuck'
          ? 'Are recent actions failing? The first step is not stuck.'
          : 'Answer using the current page and goal.';
  return warning ? base + ' ' + warning : base;
}

/**
 * Never mutate the upstream request: the browser action resolver needs all
 * original target mappings. The model sees a smaller, ranked choice set while
 * returned choice IDs still map to the original PageAction records.
 */
export function toLocalSystemOneRequest(
  input: JevRequest,
  level: LocalCompactLevel = 0
): JevRequest {
  const b = BUDGETS[level];
  const task = clip(input.state.task, b.goalChars);
  const questions: Record<string, JevQuestion> = {};
  const chosenIndices = new Set<string>();

  for (const [name, question] of Object.entries(input.questions)) {
    if (question.type !== 'choice') {
      questions[name] = { ...question, instructions: briefInstructions(name, question.instructions, b.warningChars) };
      continue;
    }

    const choices = Object.entries(question.criteria || {});
    if (choices.length === 1 && name.endsWith('_target')) {
      // The AgentRunner already resolves a sole target without another choice.
      chosenIndices.add(choices[0][0].split(':')[0]);
      continue;
    }
    const selected = choices.length <= (name.endsWith('_target') ? b.targetCandidates : 26)
      ? new Set(choices.map(([key]) => key))
      : bestCandidateKeys(choices, task, name.endsWith('_target') ? b.targetCandidates : 26);

    const criteria = Object.fromEntries(
      choices.filter(([key]) => selected.has(key))
        .map(([key, value]) => {
          if (name.endsWith('_target')) chosenIndices.add(key.split(':')[0]);
          return [key, clip(description(value), name.endsWith('_target') ? b.targetDescriptionChars : 75)];
        })
    );
    questions[name] = {
      ...question,
      criteria,
      instructions: briefInstructions(name, question.instructions, b.warningChars),
    };
  }

  const selectedElements = input.state.elements
    .map((element, index) => ({
      element,
      index,
      score: relevance(element.label + ' ' + (element.section || ''), task) +
        (chosenIndices.has(element.index) ? 4 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, b.stateElements)
    .sort((a, b) => a.index - b.index);

  const elements: ObservedElement[] = selectedElements.map(({ element }) => ({
    index: element.index,
    label: clip(element.label, b.elementLabelChars),
    operations: element.operations,
    ...(element.role ? { role: element.role } : {}),
    ...(element.section ? { section: clip(element.section, 35) } : {}),
    ...(element.href ? { href: clip(element.href, 65) } : {}),
    ...(element.value ? { value: clip(element.value, 35) } : {}),
    ...(element.expanded ? { expanded: element.expanded } : {}),
  }));

  const state = {
    task,
    page: {
      url: clip(input.state.page.url, 125),
      title: clip(input.state.page.title, 75),
      text: relevantPageText(input.state.page.text, task, b.pageChars),
    },
    elements,
    recent_actions: input.state.recent_actions.slice(-b.historyCount).map(action => ({
      step: action.step,
      action: clip(action.action, 80),
      outcome: clip(action.outcome, 85),
    })),
    ...(input.state.run ? { run: {
      steps_taken: input.state.run.steps_taken,
      start_url: clip(input.state.run.start_url, 100),
      visited_urls: input.state.run.visited_urls.slice(-2).map(url => clip(url, 100)),
    } } : {}),
  };

  return { model: input.model, state, questions: questions as JevQuestions };
}

export function isLocalPromptTooLong(error: unknown): boolean {
  const msg = String(error);
  return /HTTP 400/.test(msg) && /prompt\s+\d+\s+has\s+\d+\s+tokens/i.test(msg) &&
    /expected\s+1\s*[–-]\s*\d+/i.test(msg);
}
