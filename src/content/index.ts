import { ActResult, ExtensionMessage } from '../shared/types';
import { dispatchSynthetic, executeAction, prepareAction, settle } from './executor';
import {
  clearBadges,
  highlightTarget,
  removeStatusBanner,
  renderElementBadges,
  showStatusBanner,
} from './overlay';
import { clickRect, getCache, takeSnapshot } from './snapshot';

const failed = (err: any): ActResult => ({ ok: false, code: 'failed', message: err?.message || String(err) });

/**
 * The manifest injects this script at document_idle and the background may inject it
 * earlier on demand. Both land in the same isolated world, so a window marker guarantees a
 * single live listener: two listeners would execute every action twice. A marker left by a
 * previous extension instance (after "Reload" on chrome://extensions) is ignored because
 * that instance can no longer receive messages.
 */
const previous = window.__jevContent;
if (!previous || !previous.alive()) {
  // A previous extension context may be invalidated but its rendered badges
  // and status banner remain in the webpage. Clear them before registering a
  // new listener, including when the user Reloads Lumi from chrome://extensions.
  clearBadges();
  removeStatusBanner();
  window.__jevContent = {
    alive: () => {
      try {
        // After the extension is reloaded the old context's runtime id becomes undefined.
        return typeof chrome.runtime?.id === 'string';
      } catch {
        return false;
      }
    },
  };
  boot();
}

function boot(): void {
  let showOverlay = false;

  try {
    chrome.storage.local.get(['jev_settings'], (result) => {
      const stored = result?.jev_settings as { showOverlay?: unknown } | undefined;
      if (stored && typeof stored.showOverlay === 'boolean') {
        showOverlay = stored.showOverlay;
      }
    });
  } catch {
    // storage unavailable in this context; keep the default
  }

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse: (response: unknown) => void) => {
      switch (message.type) {
        case 'PING': {
          sendResponse({ pong: true });
          return false;
        }

        case 'CONTENT_MEDIA_STATUS': {
          const video = document.querySelector('video');
          sendResponse({
            found: Boolean(video),
            playing: Boolean(video && !video.paused && !video.ended),
            paused: Boolean(video?.paused),
            readyState: video?.readyState ?? 0,
          });
          return false;
        }

        case 'CONTENT_MEDIA_RECT': {
          const video = document.querySelector('video');
          const rect = video?.getBoundingClientRect();
          if (!video || !rect || rect.width < 20 || rect.height < 20) {
            sendResponse({ found: false });
            return false;
          }
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          const top = document.elementFromPoint(x, y);
          // Never click a player overlay link or advertisement instead of the video.
          const safe = top === video && x >= 0 && y >= 0 &&
            x < window.innerWidth && y < window.innerHeight;
          sendResponse({ found: true, safe, x, y });
          return false;
        }

        case 'CONTENT_MEDIA_PLAY': {
          const video = document.querySelector('video');
          if (!video) {
            sendResponse({ success: false, error: 'No video element has loaded yet' });
            return false;
          }
          let timer: number | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error('Timed out waiting for the video to start.')), 8000);
          });
          Promise.race([video.play(), timeout])
            .then(() => sendResponse({
              success: !video.paused && !video.ended,
              playing: !video.paused && !video.ended,
            }))
            .catch(error => sendResponse({
              success: false,
              error: error?.message || String(error),
            }))
            .finally(() => window.clearTimeout(timer));
          return true;
        }

        case 'CONTENT_OBSERVE': {
          try {
            const snapshot = takeSnapshot();
            if (!snapshot) {
              sendResponse({ success: false, error: 'Document body is not ready' });
              return false;
            }
            renderElementBadges(snapshot.actions, showOverlay);
            sendResponse({ success: true, snapshot });
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
          return false;
        }

        case 'CONTENT_ACT':
        case 'CONTENT_PREPARE': {
          if (showOverlay) highlightTarget(message.action);
          // Badges describe the previous observation; drop them before the page changes.
          clearBadges();
          const run = message.type === 'CONTENT_ACT' ? executeAction : prepareAction;
          run(message.action, message.text)
            .then((res) => sendResponse(res))
            .catch((err) => sendResponse(failed(err)));
          return true; // async sendResponse
        }

        case 'CONTENT_DISPATCH': {
          const el = getCache().nodes.get(message.action.node ?? -1);
          const r = el ? clickRect(el) : null;
          const point = r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 0, y: 0 };
          dispatchSynthetic(message.action, point, message.text)
            .then((res: ActResult) => sendResponse(res))
            .catch((err) => sendResponse(failed(err)));
          return true;
        }

        case 'CONTENT_SETTLE': {
          settle().then(() => sendResponse({ ok: true }));
          return true;
        }

        case 'CONTENT_STATUS': {
          if (message.clear || !showOverlay) {
            removeStatusBanner();
            // Otherwise [1], [2] badges are stranded on the webpage after
            // the agent finishes or fails; no new observe will remove them.
            clearBadges();
          } else if (message.text) {
            showStatusBanner(message.text, message.latencyMs);
          }
          sendResponse({ success: true });
          return false;
        }

        case 'TOGGLE_OVERLAY': {
          showOverlay = message.show;
          if (showOverlay) {
            const snapshot = takeSnapshot();
            if (snapshot) renderElementBadges(snapshot.actions, true);
          } else {
            clearBadges();
            removeStatusBanner();
          }
          sendResponse({ success: true });
          return false;
        }

        default:
          return false;
      }
    }
  );
}
