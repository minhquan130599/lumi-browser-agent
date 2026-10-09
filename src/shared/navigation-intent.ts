/**
 * Navigation planning from the USER'S explicit command only.
 * No page content or model output can authorize a new destination.
 */
export interface NavigationIntent {
  url: string;
  hostname: string;
  searchQuery?: string;
  playVideo: boolean;
  navigationOnly: boolean;
  modelGoal: string;
}

const domainCommand =
  /^\s*(?:(?:hãy|vui lòng|giúp tôi|giúp mình|tôi muốn|mình muốn|please|nhờ bạn)\s+)*(?:mở|mo|vào|vao|truy\s*cập|truy\s*cap|open|go\s+to|navigate\s+to|visit)\s+((?:https?:\/\/)?(?:(?:[a-z0-9-]+\.)+[a-z]{2,24}|(?:\d{1,3}\.){3}\d{1,3}|localhost)(?::\d{2,5})?(?:\/[^\s<>"']*)?)/iu;

const compact = (value: string): string =>
  value.trim().replace(/[\s.,!?;:]+$/u, '');

function youtubeHost(host: string): boolean {
  return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com';
}

function childQuery(commandSuffix: string): string | null {
  const match = /(?:^|\s)(?:tìm(?:\s+kiếm)?|search(?:\s+for)?|find)\s+(.+)/iu.exec(commandSuffix);
  if (!match) return null;
  let q = match[1].split(/\s+(?:và|rồi|sau\s+đó|then|and)\s+(?:bật|mở|phát|play|open|bắt\s+đầu|start)\b/iu)[0];
  q = q.replace(/^\s*(?:một|1|a|one)\s+(?:bản|bài|video|song|track)\s+/iu, '');
  q = q.replace(/^\s*(?:bài\s+hát|nhạc\s+về)\s+/iu, '');
  q = compact(q);
  return q.length >= 2 && q.length <= 160 ? q : null;
}

/** Only parse domains immediately following a navigation verb in the prompt. */
export function parseNavigationIntent(userGoal: string): NavigationIntent | null {
  const match = domainCommand.exec(userGoal.slice(0, 400));
  if (!match) return null;
  let url: URL;
  try {
    url = new URL(match[1].startsWith('http') ? match[1] : 'https://' + match[1]);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.port && Number(url.port) === 0) return null;
  // No arbitrary URLs from untrusted page text. Restrict to the typed destination.
  const suffix = userGoal.slice(match.index + match[0].length);
  const isYoutube = youtubeHost(url.hostname.toLowerCase());
  const searchQuery = isYoutube ? childQuery(suffix) : null;
  const playVideo = isYoutube && /(?:\bplay\b|\bbật\b|\bphát\b|\bnghe\b)/iu.test(suffix);
  const navigationOnly = !suffix.trim().replace(/^[,.!;\s]+|[,.!;\s]+$/g, '');
  if (searchQuery) {
    url = new URL('https://www.youtube.com/results');
    url.searchParams.set('search_query', searchQuery);
  }
  const modelGoal = searchQuery
    ? `On YouTube search results for "${searchQuery}", open a relevant video and ${playVideo ? 'start playback. Do not mark DONE until the video is actually playing.' : 'show the video page.'}`
    : navigationOnly
      ? `Navigate to ${url.origin}.`
      : `You are already at ${url.hostname}. Complete the remaining task: ${suffix.trim() || userGoal}`;

  return {
    url: url.toString(),
    hostname: url.hostname,
    searchQuery: searchQuery || undefined,
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
