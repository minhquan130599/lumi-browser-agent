import { describe, expect, it } from 'vitest';
import { suggestYoutubeVideo } from '../src/shared/youtube-support';
import type { PageAction } from '../src/shared/types';

const actions: PageAction[] = [
  { id: 'premium', kind: 'click', node: 1, role: 'link', label: 'YouTube Premium', href: '/premium' },
  { id: 'ad', kind: 'click', node: 2, role: 'link', label: 'Sponsored kids music', href: '/watch?v=ad123' },
  { id: 'song', kind: 'click', node: 3, role: 'link', label: 'Nhạc Thiếu Nhi Vui Nhộn - Bài hát cho bé', href: '/watch?v=music123' },
  { id: 'other', kind: 'click', node: 4, role: 'link', label: 'Nhạc thư giãn cho người lớn', href: '/watch?v=ambient' },
];

describe('YouTube result recovery', () => {
  it('selects a relevant video and not an ad or other site link', () => {
    expect(suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=nhac+thieu+nhi',
      actions,
    }, 'nhạc thiếu nhi')?.id).toBe('song');
  });

  it('does not trigger outside YouTube search results', () => {
    expect(suggestYoutubeVideo({ url: 'https://www.google.com/search?q=music', actions }, 'music')).toBeNull();
    expect(suggestYoutubeVideo({ url: 'https://www.youtube.com/watch?v=123', actions }, 'music')).toBeNull();
  });

  it('rejects spoofed watch links', () => {
    expect(suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=music',
      actions: [{ id: 'spoof', kind: 'click', node: 7, role: 'link', label: 'music', href: 'youtube.com.evil.test/watch?v=abc' }],
    }, 'music')).toBeNull();
  });

  it('returns null when no visible video result has loaded', () => {
    expect(suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=kids',
      actions: [{ id: 'search', kind: 'fill', node: 1, role: 'searchbox', label: 'Search' }],
    }, 'kids')).toBeNull();
  });
});
