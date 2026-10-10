import { describe, expect, it } from 'vitest';
import { isYoutubeResultPage, isYoutubeWatchPage, parseContextualYoutubeIntent, parseNavigationIntent } from '../src/shared/navigation-intent';

describe('implicit YouTube song requests on the current tab', () => {
  const watch = 'https://www.youtube.com/watch?v=I5ah1DBc8ms&list=RDabc';
  it('turns the reported failure into a search query with a separate artist verification', () => {
    const plan = parseContextualYoutubeIntent('bật bài lối nhỏ của đen vấu', watch);
    expect(plan).toMatchObject({
      searchQuery: 'lối nhỏ Đen Vâu', requestedTitle: 'lối nhỏ',
      requestedArtist: 'Đen Vâu', playVideo: true, navigationOnly: false,
    });
    expect(plan?.url).toBe('https://www.youtube.com/results?search_query=l%E1%BB%91i+nh%E1%BB%8F+%C4%90en+V%C3%A2u');
  });
  it('supports explicit YouTube requests with the same title and typo', () => {
    expect(parseNavigationIntent('mở youtube bật bài lối nhỏ của đen vấu')).toMatchObject({
      searchQuery: 'lối nhỏ Đen Vâu', requestedTitle: 'lối nhỏ',
      requestedArtist: 'Đen Vâu'
    });
  });
  it('does not mistake help, negation, or non-YouTube pages for commands', () => {
    expect(parseContextualYoutubeIntent('hướng dẫn bật bài lối nhỏ', watch)).toBeNull();
    expect(parseContextualYoutubeIntent('đừng bật bài lối nhỏ', watch)).toBeNull();
    expect(parseContextualYoutubeIntent('bật bài lối nhỏ của đen vấu', 'https://github.com')).toBeNull();
    expect(parseContextualYoutubeIntent('bật bài lối nhỏ của đen vấu', 'https://youtube.com.evil.test/watch?v=123')).toBeNull();
  });
});

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

  it('understands natural Vietnamese YouTube play requests without .com or a search verb', () => {
    const plan = parseNavigationIntent('mở youtube, bật cho tôi 1 bài rap của đen vâu');
    expect(plan).toMatchObject({
      hostname: 'www.youtube.com',
      searchQuery: 'rap đen vâu',
      playVideo: true,
      navigationOnly: false,
    });
    expect(plan?.url).toBe('https://www.youtube.com/results?search_query=rap+%C4%91en+v%C3%A2u');
    expect(plan?.modelGoal).toContain('start playback');
  });

  it.each([
    ['vào YouTube tìm nhạc của Đen Vâu rồi phát cho tôi', 'nhạc Đen Vâu', true],
    ['hãy mở trang YouTube, phát một bài rap của Đen Vâu', 'rap Đen Vâu', true],
    ['mở yt, nghe nhạc thiếu nhi', 'nhạc thiếu nhi', true],
    ['open youtube search for kids music and play it', 'kids music', true],
    ['mở YouTube, tìm bài hát Sơn Tùng', 'nhạc Sơn Tùng', false],
  ])('parses: %s', (goal, query, play) => {
    expect(parseNavigationIntent(goal)).toMatchObject({
      hostname: 'www.youtube.com', searchQuery: query, playVideo: play,
    });
  });

  it('supports spoken site names for navigation-only requests', () => {
    expect(parseNavigationIntent('mở youtube nhé')).toMatchObject({
      url: 'https://www.youtube.com/', navigationOnly: true,
    });
    expect(parseNavigationIntent('mở github')?.url).toBe('https://github.com/');
    expect(parseNavigationIntent('vào google')?.url).toBe('https://www.google.com/');
    expect(parseNavigationIntent('mở github.com')?.url).toBe('https://github.com/');
  });

  it('ignores untrusted explanatory wording and unknown site nicknames', () => {
    expect(parseNavigationIntent('Hướng dẫn cách mở youtube rồi tìm video')).toBeNull();
    expect(parseNavigationIntent('mở youtube.com.evil.test')).toMatchObject({
      url: 'https://youtube.com.evil.test/',
    });
    expect(parseNavigationIntent('mở youtubee, bật rap')).toBeNull();
    expect(parseNavigationIntent('tại sao youtube.com không phát nhạc?')).toBeNull();
  });

  it('recognizes YouTube by its spoken name and searches for rap by Đen Vâu', () => {
    const goal = 'mở youtube, bật cho tôi 1 bài rap của đen vâu';
    const plan = parseNavigationIntent(goal);
    expect(plan).toMatchObject({
      hostname: 'www.youtube.com',
      searchQuery: 'rap đen vâu',
      playVideo: true,
      navigationOnly: false,
    });
    expect(plan?.url).toBe('https://www.youtube.com/results?search_query=rap+%C4%91en+v%C3%A2u');
    expect(plan?.modelGoal).toContain('start playback');
  });

  it('accepts a short spoken site name for navigation-only commands', () => {
    expect(parseNavigationIntent('mở youtube')?.url).toBe('https://www.youtube.com/');
    expect(parseNavigationIntent('vào YouTube nhé')?.navigationOnly).toBe(true);
    expect(parseNavigationIntent('mở you tube')?.hostname).toBe('www.youtube.com');
    expect(parseNavigationIntent('mở github')?.url).toBe('https://github.com/');
    expect(parseNavigationIntent('open youtube play a song by Adele')?.searchQuery).toBe('song Adele');
  });

  it('preserves the full song name even when the user types a newline after "bài"', () => {
    const goal = 'mở youtube bật cho tôi bài \nNgày Còn Đôi Mươi';
    const plan = parseNavigationIntent(goal);
    expect(plan).toMatchObject({
      hostname: 'www.youtube.com',
      searchQuery: 'Ngày Còn Đôi Mươi',
      requestedTitle: 'Ngày Còn Đôi Mươi',
      playVideo: true,
    });
    expect(plan?.url).toBe('https://www.youtube.com/results?search_query=Ng%C3%A0y+C%C3%B2n+%C4%90%C3%B4i+M%C6%B0%C6%A1i');
    expect(plan?.modelGoal).toContain('ONLY choose a result with the full matching song title');
  });

  it('keeps broad genre and artist requests distinct from exact song titles', () => {
    expect(parseNavigationIntent('mở youtube, bật cho tôi 1 bài rap của đen vâu')).toMatchObject({
      searchQuery: 'rap đen vâu', requestedTitle: undefined,
    });
    expect(parseNavigationIntent('mở youtube.com tìm 1 bản nhạc thiếu nhi và bật cho tôi')).toMatchObject({
      searchQuery: 'nhạc thiếu nhi', requestedTitle: undefined,
    });
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
