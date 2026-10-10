import type { PageSnapshot, RecentAction } from './types';

/** Model confidence alone is never proof that a task succeeded. */
export function verifyGenericDone(
  goal: string,
  snapshot: Pick<PageSnapshot, 'url' | 'title' | 'text'>,
  history: RecentAction[]
): { verified: boolean; reason: string } {
  const actions = history.filter(item => item.kind && item.kind !== 'wait');
  if (!actions.length) return {
    verified: false, reason: 'No browser action has been executed; DONE at step 0 is not evidence.'
  };
  if (!actions.some(item => item.page_changed === true)) return {
    verified: false, reason: 'No browser action produced an observable state change.'
  };
  const g = goal.toLowerCase();
  // No generic model DONE for media playback: require actual playing state
  // and matching requested track via the dedicated YouTube verifier.
  if (/(?:bật|phát|nghe|play|mở)\s+(?:(?:cho\s+(?:tôi|mình)\s+))?(?:(?:một|1)\s+)?(?:bài|video|ca\s+khúc|bản\s+nhạc|nhạc)(?:\s|$)/iu.test(g)) {
    return { verified: false, reason: 'Playback requires matching video title, artist and actual playing state.' };
  }
  if (/(?:\bapi\b|endpoint|swagger|lấy danh sách|fetch response)/iu.test(g)) {
    const text = snapshot.text.slice(0, 3000);
    if (!/(?:response body|server response|status code|response code|\b200\b|json)/iu.test(text)) {
      return { verified: false, reason: 'No API response or status is visible after the actions.' };
    }
  }
  if (/(?:chuyển bài|next song|phát bài tiếp|play next)/iu.test(g)) {
    return { verified: false, reason: 'Media commands require player state and changed video ID verification.' };
  }
  return { verified: true, reason: 'Browser action produced an observable change.' };
}
