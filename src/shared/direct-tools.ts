import type { PageAction } from './types';

/**
 * Conservative selection policy for direct browser tools and vision fallbacks.
 * A label/ID can only select a control already seen by the DOM observer.
 */
const HIGH_IMPACT = /(?:delete|remove account|pay|purchase|checkout|transfer|send email|send message|xóa|thanh toán|mua ngay|chuyển tiền|gửi tin nhắn)/iu;
export type DirectToolName = 'navigate' | 'click_observed' | 'fill_observed' | 'scroll_observed' | 'media_control';
export const DIRECT_TOOL_NAMES: DirectToolName[] = [
  'navigate', 'click_observed', 'fill_observed', 'scroll_observed', 'media_control'
];

export function checkObservedTarget(
  action: PageAction,
  instruction: string
): { allowed: boolean; reason: string } {
  if (HIGH_IMPACT.test(action.label) && !HIGH_IMPACT.test(instruction)) {
    return { allowed: false, reason: 'High-impact action requires explicit user instruction.' };
  }
  return { allowed: true, reason: 'Observed control is permitted.' };
}
