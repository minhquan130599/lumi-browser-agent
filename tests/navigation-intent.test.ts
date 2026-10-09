import { describe, expect, it } from 'vitest';
import { isYoutubeResultPage, isYoutubeWatchPage, parseNavigationIntent } from '../src/shared/navigation-intent';

describe('explicit user navigation intent', () => {
  it('opens YouTube search results directly when user requests a song', () => {
    const plan = parseNavigationIntent('mở youtube.com tìm 1 bản nhạc thiếu nhi và bật cho tôi');
    expect(plan).toMatchObject({
      hostname: 'www.youtube.com',
      searchQuery: 'nhạc thiếu nhi',
      playVideo: true,
      navigationOnly: false,
    });
    expect(plan?.url).toBe('https://www.youtube.com/results?search_query=nh%E1%BA%A1c+thi%E1%BA%BFu+nhi');
    expect(plan?.modelGoal).toContain('Do not mark DONE until');
  });

  it('navigates to a named website without requiring a Jev decision', () => {
    expect(parseNavigationIntent('hãy mở github.com')?.url).toBe('https://github.com/');
    expect(parseNavigationIntent('hãy mở github.com')?.navigationOnly).toBe(true);
    expect(parseNavigationIntent('vào https://example.com/docs')?.url).toBe('https://example.com/docs');
  });

  it('understands English searches', () => {
    expect(parseNavigationIntent('Open youtube.com search for kids music and play it')?.searchQuery)
      .toBe('kids music');
  });

  it('does not navigate from a mere mention, spoofed scheme, or absent user navigation verb', () => {
    expect(parseNavigationIntent('Tại sao youtube.com bị chậm?')).toBeNull();
    expect(parseNavigationIntent('Hướng dẫn cách mở youtube.com')).toBeNull();
    expect(parseNavigationIntent('mở http://192.168.110.77:8002/docs')?.url).toBe('http://192.168.110.77:8002/docs');
    expect(parseNavigationIntent('test api lấy danh sách voice')).toBeNull();
    expect(parseNavigationIntent('Mở chrome://extensions')).toBeNull();
    expect(parseNavigationIntent('Mở javascript:alert(1)')).toBeNull();
    expect(parseNavigationIntent('mở youtube.com.evil.test tìm nhạc thiếu nhi')?.searchQuery).toBeUndefined();
  });

  it('recognizes actual YouTube result and watch URLs', () => {
    expect(isYoutubeResultPage('https://www.youtube.com/results?search_query=nhac+thieu+nhi')).toBe(true);
    expect(isYoutubeWatchPage('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isYoutubeWatchPage('https://youtube.com.evil.com/watch?v=abc123')).toBe(false);
    expect(isYoutubeWatchPage('https://www.youtube.com/watch?feature=share')).toBe(false);
  });
});
