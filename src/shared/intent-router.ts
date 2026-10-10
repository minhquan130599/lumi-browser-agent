import { isYoutubeWatchPage } from './navigation-intent';

export type MediaCommand = 'next' | 'previous' | 'pause' | 'resume';
export interface DirectIntent {
  kind: 'media';
  command: MediaCommand;
  verification: 'video_changed_and_playing' | 'paused' | 'playing';
}

/** Explicit commands only, and only when a YouTube watch page is active. */
export function routeDirectIntent(goal: string, currentUrl: string): DirectIntent | null {
  if (!isYoutubeWatchPage(currentUrl)) return null;
  const s = goal.toLowerCase().replace(/\s+/gu, ' ').trim()
    .replace(/^(?:hãy|vui lòng|giúp tôi|giúp mình|please|cho tôi|cho mình)\s+/iu, '')
    .replace(/(?:\s+(?:cho tôi|cho mình|giúp tôi|giúp mình|please|nhé|đi))+[.!?]*$/iu, '')
    .trim();
  if (/^(?:làm sao|cách|how|why|tại sao|hướng dẫn|giải thích|don't|đừng|không)\b/iu.test(s)) return null;
  if (/^(?:chuyển|sang|qua|bật|phát|mở|nhảy|skip)\s+(?:(?:sang|qua)\s+)?(?:bài|video|nhạc|track|song)?\s*(?:kế|tiếp|tiếp theo|khác|sau|next)(?:\s+(?:bài|song|video))?$/iu.test(s) ||
      /^(?:next(?:\s+(?:song|track|video))?|skip(?:\s+(?:song|track|video))?)$/iu.test(s)) {
    return { kind: 'media', command: 'next', verification: 'video_changed_and_playing' };
  }
  if (/^(?:bài|video|nhạc)\s+trước$/iu.test(s) ||
      /^(?:quay|trở|lùi|về|phát|bật|chuyển)\s+(?:(?:về|sang)\s+)?(?:bài|video|nhạc|track)?\s*(?:trước|trước đó|trước đây|previous)$/iu.test(s) ||
      /^(?:previous(?:\s+(?:song|track|video))?|prev(?:ious)?(?:\s+(?:song|track))?)$/iu.test(s)) {
    return { kind: 'media', command: 'previous', verification: 'video_changed_and_playing' };
  }
  if (/^(?:tạm dừng|dừng|pause|stop)(?:\s+(?:video|nhạc|bài|music))?$/iu.test(s)) {
    return { kind: 'media', command: 'pause', verification: 'paused' };
  }
  if (/^(?:tiếp tục phát|phát tiếp|resume|unpause|play|bật nhạc)(?:\s+(?:video|nhạc|bài|music))?$/iu.test(s)) {
    return { kind: 'media', command: 'resume', verification: 'playing' };
  }
  return null;
}

export interface MediaEvidence {
  videoId: string | null;
  playing: boolean;
  found: boolean;
}
export function verifyMediaCommand(
  intent: DirectIntent,
  before: MediaEvidence,
  after: MediaEvidence
): { ok: boolean; reason: string } {
  if (!after.found) return { ok: false, reason: 'YouTube player was not found after the action.' };
  if (intent.command === 'next' || intent.command === 'previous') {
    if (!before.videoId || !after.videoId) return { ok: false, reason: 'Could not read both video IDs.' };
    if (before.videoId === after.videoId) return { ok: false, reason: 'Video ID did not change; NEXT/PREVIOUS has not completed.' };
    if (!after.playing) return { ok: false, reason: 'Video changed, but the new video is not playing.' };
    return { ok: true, reason: 'Video ID changed and the new video is playing.' };
  }
  const desired = intent.command === 'pause' ? false : true;
  if (after.playing !== desired) {
    return { ok: false, reason: desired ? 'Video is still paused.' : 'Video is still playing.' };
  }
  return { ok: true, reason: desired ? 'Playback resumed.' : 'Playback paused.' };
}
