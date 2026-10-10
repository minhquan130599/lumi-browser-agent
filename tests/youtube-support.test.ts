import { describe, expect, it } from 'vitest';
import { suggestYoutubeVideo, titleMatchesRequestedSong, topicMatchesVideo, watchVideoId } from '../src/shared/youtube-support';
import type { PageAction } from '../src/shared/types';

const actions: PageAction[] = [
  { id: 'premium', kind: 'click', node: 1, role: 'link', label: 'YouTube Premium', href: '/premium' },
  { id: 'ad', kind: 'click', node: 2, role: 'link', label: 'Sponsored kids music', href: '/watch?v=ad123' },
  { id: 'song', kind: 'click', node: 3, role: 'link', label: 'Nhạc Thiếu Nhi Vui Nhộn - Bài hát cho bé', href: '/watch?v=music123' },
  { id: 'other', kind: 'click', node: 4, role: 'link', label: 'Nhạc thư giãn cho người lớn', href: '/watch?v=ambient' },
];

describe('artist + song constraint', () => {
  it('selects the actual Lối Nhỏ recording and rejects other artists/channels', () => {
    const sample: PageAction[] = [
      { id: 'channel', node: 10, role: 'link', kind: 'click',
        label: 'Dunghoangpham và Dunghoangpham Ballad', href: '/channel/dunghoangpham' },
      { id: 'wrong', node: 11, role: 'link', kind: 'click',
        label: 'Lối Nhỏ - Sơn Tùng', href: '/watch?v=otherArtist' },
      { id: 'correct', node: 12, role: 'link', kind: 'click',
        label: 'Đen Vâu - Lối Nhỏ (Official MV)', href: '/watch?v=loinho123' },
    ];
    expect(suggestYoutubeVideo({ url: 'https://www.youtube.com/results', actions: sample },
      'lối nhỏ Đen Vâu', 'lối nhỏ', 'Đen Vâu')?.id).toBe('correct');
    expect(suggestYoutubeVideo({ url: 'https://www.youtube.com/results', actions: sample.slice(0, 2) },
      'lối nhỏ Đen Vâu', 'lối nhỏ', 'Đen Vâu')).toBeNull();
  });
});

describe('YouTube result recovery', () => {
  it('selects a relevant video and not an ad or other site link', () => {
    expect(suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=nhac+thieu+nhi',
      actions,
    }, 'nhạc thiếu nhi')?.id).toBe('song');
  });

  it('prefers a Đen Vâu rap performance over an unrelated video appearing first', () => {
    const result = suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=rap+%C4%91en+v%C3%A2u',
      actions: [
        { id: 'wrong', node: 1, kind: 'click', role: 'link',
          label: 'Top bài nhạc thiếu nhi mới nhất', href: '/watch?v=unrelated123' },
        { id: 'denvau', node: 2, kind: 'click', role: 'link',
          label: 'Đen Vâu - RAP Việt Nam | Official Music Video', href: '/watch?v=denvau123' },
        { id: 'paid', node: 3, kind: 'click', role: 'link',
          label: 'Sponsored - Đen Vâu Rap', href: '/watch?v=ad123' },
      ],
    }, 'rap đen vâu');
    expect(result?.id).toBe('denvau');
  });

  it('does not play an unrelated video when no result matches the requested artist', () => {
    expect(suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=rap+den+vau',
      actions: [{ id: 'wrong', node: 1, kind: 'click', role: 'link',
        label: 'Classical music for studying', href: '/watch?v=other123' }],
    }, 'rap đen vâu')).toBeNull();
  });

  it('matches the entire named track rather than any generic music keyword', () => {
    const found = suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=Ng%C3%A0y+C%C3%B2n+%C4%90%C3%B4i+M%C6%B0%C6%A1i',
      actions: [
        { id: 'wrong', node: 1, kind: 'click', role: 'link',
          label: 'BÀI CA MÙA HẠ Remix - Xanh', href: '/watch?v=wrong123' },
        { id: 'generic', node: 2, kind: 'click', role: 'link',
          label: 'Bài hát hay nhất ngày hôm nay', href: '/watch?v=generic' },
        { id: 'requested', node: 3, kind: 'click', role: 'link',
          label: 'NGÀY CÒN ĐÔI MƯƠI - Official Music Video', href: '/watch?v=correct123' },
      ],
    }, 'Ngày Còn Đôi Mươi', 'Ngày Còn Đôi Mươi');
    expect(found?.id).toBe('requested');
    expect(titleMatchesRequestedSong('NGAY CON DOI MUOI | Official MV', 'Ngày Còn Đôi Mươi')).toBe(true);
    expect(titleMatchesRequestedSong('BÀI CA MÙA HẠ Remix', 'Ngày Còn Đôi Mươi')).toBe(false);
    expect(topicMatchesVideo('Một ngày thật đẹp', 'Ngày Còn Đôi Mươi')).toBe(false);
  });

  it('refuses an unrelated result even if it is the only visible video', () => {
    expect(suggestYoutubeVideo({
      url: 'https://www.youtube.com/results?search_query=Ngay+Con+Doi+Muoi',
      actions: [{ id: 'wrong', node: 1, kind: 'click', role: 'link',
        label: 'BÀI CA MÙA HẠ Remix', href: '/watch?v=wrong123' }],
    }, 'Ngày Còn Đôi Mươi', 'Ngày Còn Đôi Mươi')).toBeNull();
    expect(watchVideoId('https://www.youtube.com/watch?v=abc123&list=RDabc123')).toBe('abc123');
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
