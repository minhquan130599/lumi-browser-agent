import { isYoutubeWatchPage } from '../shared/navigation-intent';
import { verifyMediaCommand, type DirectIntent, type MediaEvidence } from '../shared/intent-router';
import { TrustedInput } from './input';

export interface MediaRunResult {
  ok: boolean;
  reason: string;
  beforeId: string | null;
  afterId: string | null;
  elapsedMs: number;
}

function videoId(url: string): string | null {
  try { return new URL(url).searchParams.get('v'); } catch { return null; }
}
async function status(tabId: number): Promise<{ found: boolean; playing: boolean }> {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_STATUS' });
    return { found: r?.found === true, playing: r?.playing === true };
  } catch { return { found: false, playing: false }; }
}

/** Site skill: action once, observe again, verify actual YouTube media state. */
export async function runYoutubeMediaSkill(
  tabId: number,
  intent: DirectIntent,
  input: TrustedInput,
  useTrustedInput: boolean,
  cancelled: () => boolean = () => false,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<MediaRunResult> {
  const start = Date.now();
  const initial = await chrome.tabs.get(tabId);
  const initialUrl = initial.url || '';
  if (!isYoutubeWatchPage(initialUrl)) {
    return { ok: false, reason: 'This is not a YouTube watch page.', beforeId: null, afterId: null, elapsedMs: 0 };
  }
  const before: MediaEvidence = { ...(await status(tabId)), videoId: videoId(initialUrl) };
  if (!before.found) {
    return { ok: false, reason: 'YouTube player not loaded; wait for the video page.', beforeId: before.videoId, afterId: before.videoId, elapsedMs: Date.now() - start };
  }
  if (cancelled()) return { ok: false, reason: 'Cancelled.', beforeId: before.videoId, afterId: before.videoId, elapsedMs: 0 };

  let acted = false;
  if (intent.command === 'pause') {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_PAUSE' }).catch(() => null);
    acted = r?.success === true;
  } else if (intent.command === 'resume') {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_PLAY' }).catch(() => null);
    acted = r?.success === true;
  } else {
    if (useTrustedInput && input.attachedTab !== tabId) await input.attach(tabId);
    const point = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_CONTROL_TARGET', command: intent.command }).catch(() => null);
    if (point?.found && point.safe) {
      if (input.attachedTab === tabId && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        await input.click(point.x, point.y);
        acted = true;
      } else {
        const r = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_CONTROL_CLICK', command: intent.command }).catch(() => null);
        acted = r?.success === true;
      }
    } else if (input.attachedTab === tabId) {
      // YouTube official keyboard shortcuts, only when player controls are hidden.
      await input.youtubeShortcut(intent.command);
      acted = true;
    }
  }
  if (!acted) {
    return { ok: false, reason: 'Could not safely execute the YouTube player control.', beforeId: before.videoId, afterId: before.videoId, elapsedMs: Date.now() - start };
  }

  let after: MediaEvidence = before;
  let lastReason = '';
  for (let i = 0; i < 18 && !cancelled(); i++) {
    // SPA navigation updates tab.url without triggering a full document load.
    await sleep(i < 2 ? 150 : 300);
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    const url = currentTab?.url || initialUrl;
    const state = await status(tabId);
    after = { videoId: videoId(url), ...state };
    const checked = verifyMediaCommand(intent, before, after);
    if (checked.ok) return {
      ok: true, reason: checked.reason, beforeId: before.videoId,
      afterId: after.videoId, elapsedMs: Date.now() - start
    };
    lastReason = checked.reason;
  }
  return {
    ok: false, reason: cancelled() ? 'Cancelled.' : lastReason || 'No verified media state change.',
    beforeId: before.videoId, afterId: after.videoId, elapsedMs: Date.now() - start
  };
}
