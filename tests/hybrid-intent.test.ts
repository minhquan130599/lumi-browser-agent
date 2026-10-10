import { describe, expect, it } from 'vitest';
import { routeDirectIntent, verifyMediaCommand } from '../src/shared/intent-router';
import { verifyGenericDone } from '../src/shared/completion-verifier';

const yt = 'https://www.youtube.com/watch?v=before123&list=RDbefore123';
describe('P0 deterministic media tools and verification', () => {
  it.each(['chuyển bài tiếp', 'sang bài khác', 'qua bài tiếp', 'next song', 'skip', 'chuyển bài tiếp cho tôi'])(
    'interprets %s as YouTube Next', goal => {
      expect(routeDirectIntent(goal, yt)?.command).toBe('next');
    }
  );
  it('does not execute when it is a question, or on a different site', () => {
    expect(routeDirectIntent('làm sao chuyển bài tiếp', yt)).toBeNull();
    expect(routeDirectIntent('chuyển bài tiếp', 'https://github.com/')).toBeNull();
  });
  it.each([['tạm dừng', 'pause'], ['tiếp tục phát', 'resume'], ['bài trước', 'previous']])(
    'classifies %s', (goal, expected) => {
      expect(routeDirectIntent(goal!, yt)?.command ?? null).toBe(expected);
    }
  );
  const next = routeDirectIntent('chuyển bài tiếp', yt)!;
  it('refuses false DONE when the video ID is unchanged', () => {
    const result = verifyMediaCommand(next,
      { videoId: 'first', found: true, playing: true },
      { videoId: 'first', found: true, playing: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not change');
  });
  it('requires new video ID AND playing', () => {
    expect(verifyMediaCommand(next,
      { videoId: 'first', found: true, playing: true },
      { videoId: 'second', found: true, playing: false }).ok).toBe(false);
    expect(verifyMediaCommand(next,
      { videoId: 'first', found: true, playing: true },
      { videoId: 'second', found: true, playing: true }).ok).toBe(true);
  });
  it('never counts a random channel click as correct song playback', () => {
    const evidence = verifyGenericDone('bật bài lối nhỏ của đen vấu',
      { url: 'https://www.youtube.com/watch?v=abc', title: 'Dunghoangpham - YouTube', text: 'Channel opened' },
      [{ action: 'CLICK Dunghoangpham', kind: 'click', page_changed: true }]);
    expect(evidence.verified).toBe(false);
    expect(evidence.reason).toContain('Playback');
  });
  it('vetoes model DONE without action evidence', () => {
    const page = { url: 'https://example.com/', title: 'Example', text: 'Ready' };
    expect(verifyGenericDone('click Submit', page, []).verified).toBe(false);
    expect(verifyGenericDone('click Submit', page,
      [{ action: 'CLICK Submit', kind: 'click', page_changed: false }]).verified).toBe(false);
    expect(verifyGenericDone('click Submit', { ...page, text: 'Success saved' },
      [{ action: 'CLICK Submit', kind: 'click', page_changed: true }]).verified).toBe(true);
  });
});
