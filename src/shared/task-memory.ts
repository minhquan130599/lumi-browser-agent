/** Session-only summaries, not raw page text, prompts, field values or keys. */
export interface TaskMemory {
  tabId: number;
  host: string;
  goal: string;
  outcome: 'done' | 'blocked' | 'error';
  lastOperation: string;
  updatedAt: number;
}
const KEY = 'lumi_task_context_v2';
const TTL_MS = 6 * 60 * 60 * 1000;
export function sanitizeMemory(input: TaskMemory): TaskMemory {
  return {
    tabId: input.tabId,
    host: input.host.replace(/[^a-z0-9.-]/gi, '').slice(0, 120),
    goal: input.goal.slice(0, 160)
      .replace(/https?:\/\/\S+/g, '[url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\b(password|passwd|api[_ -]?key|token|secret)\s*(?::|=|là)\s*\S+/gi, '$1=[redacted]'),
    outcome: input.outcome,
    lastOperation: input.lastOperation.slice(0, 65),
    updatedAt: input.updatedAt,
  };
}
export async function readTaskMemory(tabId: number): Promise<TaskMemory | null> {
  try {
    if (!chrome.storage?.session) return null;
    const v = await chrome.storage.session.get(KEY);
    const list = v[KEY] as TaskMemory[] | undefined;
    return (list || []).find(item => item.tabId === tabId && Date.now() - item.updatedAt < TTL_MS) ?? null;
  } catch { return null; }
}
export async function rememberTask(item: TaskMemory): Promise<void> {
  try {
    if (!chrome.storage?.session) return;
    const v = await chrome.storage.session.get(KEY);
    const others = ((v[KEY] || []) as TaskMemory[])
      .filter(x => x.tabId !== item.tabId && Date.now() - x.updatedAt < TTL_MS);
    await chrome.storage.session.set({ [KEY]: [sanitizeMemory(item), ...others].slice(0, 15) });
  } catch { /* service worker restarted or session storage unavailable */ }
}
