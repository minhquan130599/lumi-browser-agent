/**
 * Deterministic navigation planning from the USER'S explicit request.
 * Never parse instructions embedded in the webpage or proposed by a model.
 */
export interface NavigationIntent {
  url: string;
  hostname: string;
  searchQuery?: string;
  playVideo: boolean;
  navigationOnly: boolean;
  modelGoal: string;
}

const navigationPrefix =
  /^\s*(?:(?:hãy|vui lòng|giúp tôi|giúp mình|tôi muốn|mình muốn|please|nhờ bạn)\s+)*(?:mở|mo|vào|vao|truy\s*cập|truy\s*cap|open|go\s+to|navigate\s+to|visit)\s+(?:(?:trang|trang\s+web|website)\s+)?/iu;

/** Recognize explicit URL/domain/IP targets without interpreting arbitrary page text. */
const domainTarget =
  /^((?:https?:\/\/)?(?:(?:[a-z0-9-]+\.)+[a-z]{2,24}|(?:\d{1,3}\.){3}\d{1,3}|localhost)(?::\d{2,5})?(?:\/[^\s<>"']*)?)/iu;

/** Only a small allow-list of unambiguous, commonly spoken site names. */
const knownSites: Record<string, string> = {
  youtube: 'https://www.youtube.com/',
  yt: 'https://www.youtube.com/',
  google: 'https://www.google.com/',
  github: 'https://github.com/',
  gmail: 'https://mail.google.com/',
  facebook: 'https://www.facebook.com/',
  tiktok: 'https://www.tiktok.com/',
  instagram: 'https://www.instagram.com/',
  wikipedia: 'https://vi.wikipedia.org/',
};

const compact = (value: string): string =>
  value.trim().replace(/[\s.,!?;:]+$/u, '');

function youtubeHost(host: string): boolean {
  return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com';
}

function trimCommandSuffix(value: string): string {
  return value.replace(/^[\s,;.!?:]+/u, '').trim();
}

function isNavigationOnly(suffix: string): boolean {
  const remainder = trimCommandSuffix(suffix).replace(/[.,!?;:\s]+$/u, '');
  return !remainder || /^(?:nhé|đi|giúp tôi|giúp mình|cho tôi|cho mình|please|thôi)$/iu.test(remainder);
}

function youtubeSearchTerms(suffix: string): string | undefined {
  const command = trimCommandSuffix(suffix);
  // If the user explicitly says to search, take those words, not the
  // later instruction to play/open the selected result.
  const search = /(?:^|[\s,;])(?:tìm(?:\s+kiếm)?|search(?:\s+for)?|find)\s+(.+)/iu.exec(command);
  const play = /(?:^|[\s,;])(?:(?:cho\s+(?:tôi|mình|em)\s+))?(?:bật|phát|nghe|play|mở|xem)(?:\s+(?:cho\s+(?:tôi|mình|em)|giúp\s+(?:tôi|mình)|me))?\s+(.+)/iu.exec(command);

  const target = search?.[1] || play?.[1];
  if (!target) return undefined;
  let query = target
    .split(/\s+(?:(?:và|rồi|sau\s+đó|then|and)\s+)?(?:bật|phát|play|mở|xem|nghe)\s+(?:cho|để|video|it|tôi|mình|me)\b/iu)[0]
    .replace(/\s+(?:cho\s+(?:tôi|mình)(?:\s+nghe)?|giúp\s+(?:tôi|mình)|please|nhé|đi)\s*$/iu, '')
    .trim();

  // "bật cho tôi 1 bài rap của Đen Vâu" -> "rap Đen Vâu".
  // "mở youtube tìm 1 bản nhạc thiếu nhi" -> "nhạc thiếu nhi".
  query = query.replace(/^(?:một|1|one|an?|any|vài|mấy)\s+/iu, '');
  query = query.replace(/^(?:bài\s+hát|ca\s+khúc|bản\s+nhạc|bài\s+nhạc)\s+/iu, 'nhạc ');
  query = query.replace(/^(?:bài\s+rap|bản\s+rap)\s+/iu, 'rap ');
  query = query.replace(/^(?:bài|bản|video|track)\s+/iu, '');
  query = query.replace(/\s+(?:của|do|by)\s+/giu, ' ');
  query = compact(query.replace(/\s+/gu, ' '));
  return query.length >= 2 && query.length <= 160 ? query : undefined;
}

/** Returns null when the user does not explicitly command navigation. */
export function parseNavigationIntent(userGoal: string): NavigationIntent | null {
  const goal = userGoal.slice(0, 500);
  const prefix = navigationPrefix.exec(goal);
  if (!prefix) return null;

  const remainder = goal.slice(prefix[0].length);
  let rawTarget: string;
  let suffix: string;

  const explicit = domainTarget.exec(remainder);
  if (explicit) {
    rawTarget = explicit[1];
    suffix = remainder.slice(rawTarget.length);
  } else {
    const alias = /^(you\s*tube|youtube|yt|google|github|gmail|facebook|tiktok|instagram|wikipedia)(?=$|[\s,;.!?:])/iu.exec(remainder);
    if (!alias) return null;
    const key = alias[1].toLowerCase().replace(/\s+/g, '');
    rawTarget = knownSites[key];
    suffix = remainder.slice(alias[0].length);
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawTarget) ? rawTarget : 'https://' + rawTarget);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || (url.port && Number(url.port) === 0)) return null;

  const isYoutube = youtubeHost(url.hostname.toLowerCase());
  const cleanedSuffix = trimCommandSuffix(suffix);
  const searchQuery = isYoutube ? youtubeSearchTerms(cleanedSuffix) : undefined;
  const playVideo = isYoutube && (
    /(?:^|[\s,;])(?:bật|phát|nghe|play|xem)(?=$|[\s,;.!?])/iu.test(cleanedSuffix) &&
    !/(?:không|đừng|do\s+not|don't)\s+(?:bật|phát|play)/iu.test(cleanedSuffix)
  );
  const navigationOnly = isNavigationOnly(cleanedSuffix);

  if (searchQuery) {
    url = new URL('https://www.youtube.com/results');
    url.searchParams.set('search_query', searchQuery);
  }

  const modelGoal = searchQuery
    ? 'On YouTube search results for "' + searchQuery + '", open a relevant video and ' +
      (playVideo ? 'start playback. Do not mark DONE until the video is actually playing.' : 'show the video page.')
    : navigationOnly
      ? 'Navigate to ' + url.origin + '.'
      : 'You are already at ' + url.hostname + '. Complete the remaining task: ' + (cleanedSuffix || userGoal);

  return {
    url: url.toString(),
    hostname: url.hostname,
    searchQuery,
    playVideo,
    navigationOnly,
    modelGoal,
  };
}

export function isYoutubeResultPage(url: string): boolean {
  try {
    const u = new URL(url);
    return youtubeHost(u.hostname.toLowerCase()) && u.pathname === '/results';
  } catch { return false; }
}

export function isYoutubeWatchPage(url: string): boolean {
  try {
    const u = new URL(url);
    return youtubeHost(u.hostname.toLowerCase()) && u.pathname === '/watch' &&
      Boolean(u.searchParams.get('v'));
  } catch { return false; }
}
