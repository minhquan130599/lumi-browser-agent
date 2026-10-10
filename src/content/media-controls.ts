import type { MediaCommand } from '../shared/intent-router';

function controlElement(command: MediaCommand): HTMLElement | null {
  const selectors: Record<MediaCommand, string> = {
    next: '.ytp-next-button',
    previous: '.ytp-prev-button',
    pause: '.ytp-play-button',
    resume: '.ytp-play-button',
  };
  return document.querySelector<HTMLElement>(selectors[command]);
}

/** Only the YouTube PLAYER controls, not arbitrary playlist or page links. */
export function mediaControlTarget(command: MediaCommand): {
  found: boolean; safe: boolean; x?: number; y?: number
} {
  if (!['next', 'previous', 'pause', 'resume'].includes(command)) return { found: false, safe: false };
  const control = controlElement(command);
  if (!control || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') {
    return { found: false, safe: false };
  }
  const rect = control.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return { found: false, safe: false };
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    return { found: true, safe: false };
  }
  const top = document.elementFromPoint(x, y);
  return { found: true, safe: Boolean(top && (top === control || control.contains(top))), x, y };
}

export function clickMediaControl(command: MediaCommand): { success: boolean; error?: string } {
  const point = mediaControlTarget(command);
  if (!point.found || !point.safe) return { success: false, error: 'YouTube player control is not safely visible.' };
  const el = controlElement(command);
  if (!el) return { success: false, error: 'The player control disappeared.' };
  el.click();
  return { success: true };
}
