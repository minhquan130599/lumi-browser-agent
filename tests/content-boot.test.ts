// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeChrome(id: string | undefined) {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id, onMessage: { addListener } },
    storage: { local: { get: vi.fn((_k: unknown, cb: (r: unknown) => void) => cb({})) } },
  });
  return addListener;
}

describe('content script boot guard', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).__jevContent;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registers one listener on first load and publishes a liveness marker', async () => {
    const addListener = fakeChrome('ext-1');
    await import('../src/content/index');
    expect(addListener).toHaveBeenCalledTimes(1);
    expect((window as any).__jevContent.alive()).toBe(true);
  });

  it('does not register a second listener when a live instance already exists', async () => {
    const addListener = fakeChrome('ext-1');
    (window as any).__jevContent = { alive: () => true };
    await import('../src/content/index');
    expect(addListener).not.toHaveBeenCalled();
  });

  it('immediately removes numbered badges when the user hides the overlay', async () => {
    const addListener = fakeChrome('ext-3');
    await import('../src/content/index');
    const listener = addListener.mock.calls[0][0];
    const { initOverlay } = await import('../src/content/overlay');
    const overlay = initOverlay();
    const badge = document.createElement('span');
    badge.className = '__jev_badge';
    overlay.appendChild(badge);
    const reply = vi.fn();

    listener({ type: 'TOGGLE_OVERLAY', show: false }, {}, reply);
    expect(overlay.querySelector('.__jev_badge')).toBeNull();
    expect(reply).toHaveBeenCalledWith({ success: true });
    overlay.remove();
  });

  it('clears leftover badges when the agent completes or fails', async () => {
    const addListener = fakeChrome('ext-4');
    await import('../src/content/index');
    const listener = addListener.mock.calls[0][0];
    const { initOverlay } = await import('../src/content/overlay');
    const overlay = initOverlay();
    const badge = document.createElement('span');
    badge.className = '__jev_badge';
    overlay.appendChild(badge);
    const reply = vi.fn();

    listener({ type: 'CONTENT_STATUS', clear: true }, {}, reply);
    expect(overlay.querySelector('.__jev_badge')).toBeNull();
    expect(reply).toHaveBeenCalledWith({ success: true });
    overlay.remove();
  });

  it('cleans stale overlay nodes left by the previous extension version on Reload', async () => {
    const addListener = fakeChrome('ext-5');
    const orphan = document.createElement('div');
    orphan.id = '__jev_overlay_container';
    const badge = document.createElement('span');
    badge.className = '__jev_badge';
    const banner = document.createElement('span');
    banner.id = '__jev_status_banner';
    orphan.append(badge, banner);
    document.documentElement.appendChild(orphan);
    (window as any).__jevContent = { alive: () => false };

    await import('../src/content/index');
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('#__jev_overlay_container .__jev_badge')).toHaveLength(0);
    expect(document.querySelector('#__jev_status_banner')).toBeNull();
    orphan.remove();
  });

  it('boots again when the previous instance belongs to a reloaded (dead) extension', async () => {
    const addListener = fakeChrome('ext-2');
    // Marker left by the old instance: its chrome.runtime.id is gone after the reload.
    (window as any).__jevContent = { alive: () => false };
    await import('../src/content/index');
    expect(addListener).toHaveBeenCalledTimes(1);
    expect((window as any).__jevContent.alive()).toBe(true);
  });
});
