import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAgentPlan, planWithChatAI } from '../src/shared/planner';
afterEach(() => vi.unstubAllGlobals());

describe('P1 Chat AI structured Intent Planner', () => {
  it('accepts a safe 3-step task plan', () => {
    const raw = JSON.stringify({ intent: 'browser_task',
      subgoals: ['Find GET /v1/voices', 'Open Try it out', 'Execute GET and inspect response'],
      successCriteria: 'A visible server response and status code'
    });
    const plan = parseAgentPlan(raw, 'test API GET /v1/voices in Swagger');
    expect(plan.subgoals).toHaveLength(3);
    expect(plan.successCriteria).toContain('server response');
  });
  it('rejects model-invented new domains and destructive actions', () => {
    expect(() => parseAgentPlan(JSON.stringify({
      intent: 'browser_task', subgoals: ['Open https://evil.example/collect'], successCriteria: 'ok'
    }), 'Find test API on example.com')).toThrow(/domain/);
    expect(() => parseAgentPlan(JSON.stringify({
      intent: 'browser_task', subgoals: ['Delete account'], successCriteria: 'ok'
    }), 'Check current account settings')).toThrow(/prohibited/);
  });
  it('uses the configured Ollama chat model without a second API key', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        intent: 'browser_task', subgoals: ['Open the voices GET operation'],
        successCriteria: 'Voice response is visible'
      }) } }] })
    });
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({
      lumi_ai: { kind: 'ollama', model: 'qwen3:8b',
        baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }
    })) } } });
    const plan = await planWithChatAI('Open GET /v1/voices',
      { url: 'http://localhost:8002/docs', title: 'Swagger', text: 'GET /v1/voices',
        controls: ['GET /v1/voices'] }, null);
    expect(plan.subgoals[0]).toContain('voices');
    expect(request.mock.calls[0][0]).toContain('/v1/chat/completions');
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe('qwen3:8b');
  });

  it('rejects invented scripts and unbounded subgoals', () => {
    expect(() => parseAgentPlan(JSON.stringify({
      intent: 'browser_task', subgoals: ['javascript:alert(1)']
    }), 'Find button')).toThrow(/prohibited/);
    expect(() => parseAgentPlan(JSON.stringify({
      intent: 'browser_task', subgoals: Array(4).fill('click')
    }), 'Find button')).toThrow(/1 to 3/);
  });
});
