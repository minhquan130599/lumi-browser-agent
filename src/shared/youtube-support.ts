import type { PageAction, PageSnapshot } from './types';
import { isYoutubeResultPage } from './navigation-intent';

function searchWords(value: string): string[] {
  return value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .split(/[^a-z0-9]+/).filter(v => v.length > 2);
}

function validWatchLink(href: string | undefined, pageUrl: string): boolean {
  if (!href) return false;
  try {
    const u = new URL(href, pageUrl);
    return ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname) &&
      u.pathname === '/watch' && Boolean(u.searchParams.get('v'));
  } catch { return false; }
}

/** Video link candidates are only used after Jev explicitly fails to progress. */
export function suggestYoutubeVideo(
  snapshot: Pick<PageSnapshot, 'url' | 'actions'>,
  searchQuery: string
): PageAction | null {
  if (!isYoutubeResultPage(snapshot.url)) return null;
  const query = searchWords(searchQuery);
  const candidates = snapshot.actions
    .filter(action => action.kind === 'click' && action.role === 'link' &&
      validWatchLink(action.href, snapshot.url) &&
      !/\b(ad|sponsored|quảng cáo|tài trợ)\b/iu.test(action.label))
    .map((action, index) => {
      const labelWords = searchWords(action.label);
      const matches = query.filter(term => labelWords.some(word => word === term ||
        word.startsWith(term.endsWith('s') ? term.slice(0, -1) : term))).length;
      return { action, index, matches };
    })
    .sort((a, b) => b.matches - a.matches || a.index - b.index);
  return candidates[0]?.action ?? null;
}
