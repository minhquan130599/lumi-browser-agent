import type { PageAction, PageSnapshot } from './types';

/**
 * A conservative, deterministic fallback for Swagger API documentation.
 *
 * Only discovers a clearly matching GET accordion. It never presses Execute,
 * submits forms, navigates to arbitrary URLs or performs HTTP requests.
 */
export interface SwaggerGetSuggestion {
  action: PageAction;
  path: string;
  hint: string;
}

const normalize = (value: string): string =>
  value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase();

function pathFromGetLabel(label: string): string | null {
  const clean = label.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  // Handles both "GET /v1 /voices Voices" and "get /v1/voices".
  const match = /^GET\s+(\/[\w.%{}-]+(?:\s*\/[\w.%{}-]+)*)/i.exec(clean);
  return match ? match[1].replace(/\s+/g, '').toLowerCase() : null;
}

function routeWord(segment: string): string {
  const word = segment.toLowerCase();
  return word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word;
}

function goalMentionsRoute(goal: string, route: string): boolean {
  const normalizedGoal = normalize(goal);
  if (normalizedGoal.includes(route)) return true;

  // Map a few frequent Vietnamese requests to English API resource nouns.
  const impliedResources: Record<string, string> = {
    voice: 'voice|giong|giong noi',
    health: 'health|suc khoe',
    account: 'account|tai khoan',
    user: 'users|user|nguoi dung',
    model: 'models|model|mo hinh',
  };
  const goalWords = normalizedGoal.split(/[^a-z0-9]+/).filter(Boolean);
  const normalizedRoute = route.replace(/\/v\d+\//, '/');
  const lastSegment = normalizedRoute.split('/').filter(Boolean).pop() || '';
  if (!lastSegment || lastSegment.startsWith('{')) return false;

  const wanted = routeWord(lastSegment);
  const expressions = impliedResources[wanted]?.split('|') || [wanted];
  return expressions.some(phrase => {
    if (phrase.includes(' ')) return normalizedGoal.includes(phrase);
    return goalWords.includes(phrase);
  });
}

export function suggestSwaggerGetOperation(
  snapshot: Pick<PageSnapshot, 'title' | 'actions'>,
  goal: string
): SwaggerGetSuggestion | null {
  if (!/swagger(?:\s+ui)?|openapi/i.test(snapshot.title)) return null;
  if (!/\b(api|endpoint|test|kiem tra|thu|lay|list|get)\b/i.test(normalize(goal))) return null;

  const options = snapshot.actions
    .filter(action => action.kind === 'click' && action.role === 'button')
    .map(action => ({ action, path: pathFromGetLabel(action.label) }))
    .filter((entry): entry is { action: PageAction; path: string } => Boolean(entry.path))
    .filter(entry => goalMentionsRoute(goal, entry.path));

  const distinctPaths = [...new Set(options.map(item => item.path))];
  if (distinctPaths.length !== 1) return null;

  const path = distinctPaths[0];
  const candidates = options.filter(entry => entry.path === path);
  // Swagger usually exposes both an operation-header control and nested
  // buttons. The full uppercase GET label is the operation header.
  const best = candidates.find(({ action }) => /^GET\s+/.test(action.label.trim())) || candidates[0];
  const start = snapshot.actions.indexOf(best.action);
  const sameOperationControls: PageAction[] = [];
  for (const action of snapshot.actions.slice(start + 1)) {
    const isRouteHeader = /^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(
      action.label.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
    );
    if (isRouteHeader && pathFromGetLabel(action.label) !== path) break;
    sameOperationControls.push(action);
  }
  // This operation is already open: do not accidentally collapse it.
  if (sameOperationControls.some(action => /^try it out$|^execute$/i.test(action.label.trim()))) {
    return null;
  }
  return {
    action: best.action,
    path,
    hint: `Swagger GET ${path}: open this endpoint accordion first. Then find "Try it out" and "Execute" if the user requested an API test, and inspect the HTTP response.`,
  };
}
