import type { PageAction, PageSnapshot } from './types';
import { isYoutubeResultPage } from './navigation-intent';

export function normalizeVideoText(value: string): string {
  return value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const genericTerms = new Set(['bai', 'ban', 'nhac', 'music', 'song', 'video', 'hat', 'clip', 'official']);

function searchWords(value: string): string[] {
  return normalizeVideoText(value).split(' ')
    .filter(word => word.length > 2 && !genericTerms.has(word));
}

/** Exact requested track must appear as consecutive words, not as isolated keywords. */
export function titleMatchesRequestedSong(videoTitle: string, requestedTitle: string): boolean {
  const title = normalizeVideoText(videoTitle);
  const requested = normalizeVideoText(requestedTitle);
  return requested.length > 0 && title.length > 0 &&
    (' ' + title + ' ').includes(' ' + requested + ' ');
}

/** For broad searches, require meaningful overlap; never accept a filler word. */
export function topicMatchesVideo(videoTitle: string, searchQuery: string): boolean {
  const query = searchWords(searchQuery);
  if (!query.length) return false;
  const words = new Set(searchWords(videoTitle));
  const hits = query.filter(term => words.has(term)).length;
  return hits >= Math.max(1, Math.ceil(query.length * 0.65));
}

export function watchVideoId(href: string, baseUrl?: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname) ||
        u.pathname !== '/watch') return null;
    return u.searchParams.get('v');
  } catch { return null; }
}

/**
 * Choose only observed clickable YouTube videos that actually match the user's
 * search. For a named song, the full normalized song title must appear in the
 * result label. The first generic matching result must never be treated as
 * sufficient for an exact-title request.
 */
export function suggestYoutubeVideo(
  snapshot: Pick<PageSnapshot, 'url' | 'actions'>,
  searchQuery: string,
  requestedTitle?: string
): PageAction | null {
  if (!isYoutubeResultPage(snapshot.url)) return null;
  const queryWords = searchWords(searchQuery);
  return snapshot.actions
    .filter(action => action.kind === 'click' && action.role === 'link' &&
      watchVideoId(action.href || '', snapshot.url) &&
      !/\b(ad|sponsored|quảng cáo|tài trợ)\b/iu.test(action.label))
    .map((action, index) => {
      const label = normalizeVideoText(action.label);
      const eligible = requestedTitle
        ? titleMatchesRequestedSong(action.label, requestedTitle)
        : topicMatchesVideo(action.label, searchQuery);
      const hits = queryWords.filter(word => (' ' + label + ' ').includes(' ' + word + ' ')).length;
      const exactBonus = requestedTitle && titleMatchesRequestedSong(action.label, requestedTitle) ? 100 : 0;
      return { action, index, eligible, score: hits + exactBonus };
    })
    .filter(candidate => candidate.eligible)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.action ?? null;
}
