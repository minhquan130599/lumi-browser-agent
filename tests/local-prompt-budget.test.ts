import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildJevRequest } from '../src/shared/action-space';
import { callTypeSafe } from '../src/shared/providers/typesafe';
import { isLocalPromptTooLong, toLocalSystemOneRequest } from '../src/shared/providers/local-systemone';
import type { PageAction, PageSnapshot } from '../src/shared/types';

const apiActions: PageAction[] = [
  ...Array.from({ length: 35 }, (_, i) => ({
    id: 'endpoint' + i,
    node: i + 1,
    role: 'button',
    kind: 'click' as const,
    label: 'GET /v1/' + (i === 32 ? 'voices Voices' : 'resource' + i + ' Endpoint'),
    section: 'OpenAPI endpoints',
  })),
  { id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 490 },
  { id: 'wait', kind: 'wait', label: 'Wait for new content' },
];

const snapshot: PageSnapshot = {
  url: 'http://localhost:8002/docs#/',
  title: 'VieNeu Remote TTS - Swagger UI',
  text: ('Documentation GET /v1/root GET /v1/health GET /v1/voices Voices. ' +
    'Try it out and Execute to fetch the voice list. ').repeat(70),
  actions: apiActions,
  omitted_actions: 0,
  w: 1300,
  h: 820,
  scroll: { y: 0, height: 4200 },
};

function largeRequest() {
  return buildJevRequest(
    'tev1',
    snapshot,
    'test api lấy danh sách voice',
    Array.from({ length: 9 }, (_, i) => ({
      step: i + 1,
      action: 'CLICK ' + 'Expanded API operation ' + i,
      outcome: 'Content unchanged after clicking, looking for /v1/voices',
      page_changed: false,
    })),
    { warning: 'Do not try unrelated API endpoints; open the GET /v1/voices operation.' },
    { start_url: snapshot.url, steps_taken: 9, visited_urls: [snapshot.url] }
  ).request;
}

afterEach(() => vi.unstubAllGlobals());

describe('small local Jev model prompt budget', () => {
  it('keeps the requested voice endpoint even though it is late in a long list', () => {
    const input = largeRequest();
    const original = JSON.stringify(input);
    const levels = ([0, 1, 2] as const).map(level => toLocalSystemOneRequest(input, level));
    const sizes = levels.map(value => JSON.stringify(value).length);
    expect(sizes[0]).toBeLessThan(original.length / 2);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
    for (const converted of levels) {
      const click = converted.questions.click_target.criteria as Record<string, string>;
      expect(Object.values(click).some(label => label.includes('voices'))).toBe(true);
      expect(Object.values(click).every(text => typeof text === 'string')).toBe(true);
      expect(Object.keys(click).length).toBeLessThanOrEqual(10);
      expect(converted.state.page.text.length).toBeLessThanOrEqual(700);
    }
    expect(JSON.stringify(input)).toBe(original);
  });

  it('automatically retries with a shorter prompt only on context overflow HTTP 400', async () => {
    const payloads: any[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      if (payloads.length < 3) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: 'prompt 0 has 4257 tokens; expected 1–2050 (input is never truncated)',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ model: 'tev1', answers: { operation: { choice: 'CLICK' } } }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await callTypeSafe({
      apiKey: '',
      model: 'tev1',
      endpoint: 'http://127.0.0.1:11434/v1/systemone',
    }, largeRequest());
    expect(result.model).toBe('tev1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(payloads[0]).length).toBeGreaterThan(JSON.stringify(payloads[1]).length);
    expect(JSON.stringify(payloads[1]).length).toBeGreaterThan(JSON.stringify(payloads[2]).length);
  });

  it('does not reissue non-size HTTP 400 errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'invalid choice format' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(callTypeSafe({
      apiKey: '',
      model: 'tev1',
      endpoint: 'http://127.0.0.1:11434/v1/systemone',
    }, largeRequest())).rejects.toThrow('invalid choice format');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('matches only token limit errors from local HTTP 400', () => {
    expect(isLocalPromptTooLong('TypeSafe API error (HTTP 400): {"error":"prompt 0 has 4257 tokens; expected 1–2050"}')).toBe(true);
    expect(isLocalPromptTooLong('HTTP 400: schema bad')).toBe(false);
    expect(isLocalPromptTooLong('HTTP 403: prompt 0 has 4257 tokens; expected 1–2050')).toBe(false);
  });
});
