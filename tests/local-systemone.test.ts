import { describe, expect, it, vi, afterEach } from 'vitest';
import { isLocalSystemOneEndpoint, toLocalSystemOneRequest } from '../src/shared/providers/local-systemone';
import { callTypeSafe } from '../src/shared/providers/typesafe';
import type { JevRequest } from '../src/shared/types';

const request: JevRequest = {
  model: 'tev1',
  state: {
    task: 'test api lấy danh sách voice',
    page: { url: 'http://localhost/docs', title: 'Swagger UI', text: 'GET /v1/voices' },
    elements: [],
    recent_actions: [],
  },
  questions: {
    operation: {
      type: 'choice',
      instructions: { goal: 'voice list' },
      criteria: { CLICK: 'Click a visible endpoint', DONE: 'Done', BLOCKED: 'Blocked' },
    },
    click_target: {
      type: 'choice',
      instructions: 'Select a target',
      criteria: {
        '1': { element: 'GET /v1/voices', role: 'button', section: 'Voices' },
      },
    },
    goal_done: { type: 'noul', instructions: 'Is the goal complete?' },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('Self-hosted SystemOne compatibility', () => {
  it('only adapts private network hosts using the SystemOne route', () => {
    expect(isLocalSystemOneEndpoint('http://192.168.142.82:11434/v1/systemone')).toBe(true);
    expect(isLocalSystemOneEndpoint('http://127.0.0.1:8080/v1/systemone')).toBe(true);
    expect(isLocalSystemOneEndpoint('https://api.typesafe.ai/v1/systemone')).toBe(false);
    expect(isLocalSystemOneEndpoint('https://example.com/v1/systemone')).toBe(false);
    expect(isLocalSystemOneEndpoint('http://192.168.142.82:11434/v1/chat/completions')).toBe(false);
  });

  it('preserves the action space but omits singleton target questions', () => {
    const result = toLocalSystemOneRequest(request);
    expect(result.questions).not.toHaveProperty('click_target');
    expect(result.questions).toHaveProperty('goal_done');
    expect(result.questions.operation.criteria).toEqual(request.questions.operation.criteria);
    expect(request.questions).toHaveProperty('click_target');
  });

  it('flattens choice metadata into a descriptive string', () => {
    const input = structuredClone(request);
    input.questions.click_target.criteria = {
      '1': { element: '[1] Voice list', role: 'button', section: 'Voices' },
      '2': { element: '[2] Health status', role: 'link' },
    };
    const result = toLocalSystemOneRequest(input);
    const criteria = result.questions.click_target.criteria as Record<string, string>;
    expect(criteria['1']).toContain('Voice list');
    expect(criteria['1']).toContain('section: Voices');
    expect(criteria['2']).toContain('Health status');
  });

  it('keeps a matching target when there are more than 26 choices', () => {
    const input = structuredClone(request);
    const large = Object.fromEntries(
      Array.from({ length: 35 }, (_, index) => [
        String(index + 1),
        { element: index === 33 ? 'GET /v1/voices Voices' : 'GET /v1/other' + index },
      ])
    );
    input.questions.click_target.criteria = large;
    const result = toLocalSystemOneRequest(input);
    const keys = Object.keys(result.questions.click_target.criteria as Record<string, unknown>);
    expect(keys).toHaveLength(10);
    expect(keys).toContain('34');
    expect(keys).not.toContain('30');
  });

  it('sends the normalized schema to local Ollama with no API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'tev1', answers: { operation: { choice: 'CLICK' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await callTypeSafe({
      model: 'tev1',
      apiKey: '',
      endpoint: 'http://192.168.142.82:11434/v1/systemone',
    }, request);
    expect(result.model).toBe('tev1');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).not.toHaveProperty('Authorization');
    const body = JSON.parse(options.body);
    expect(body.questions).not.toHaveProperty('click_target');
    expect(body.model).toBe('tev1');
  });

  it('reports the Ollama origin allow-list remedy for a LAN HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' }));
    await expect(callTypeSafe({
      model: 'tev1',
      apiKey: '',
      endpoint: 'http://192.168.142.82:11434/v1/systemone',
    }, request)).rejects.toThrow('OLLAMA_ORIGINS');
  });
});
