import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/background/agent';
import { callJevProvider } from '../src/shared/providers';
import { planWithChatAI } from '../src/shared/planner';
import { DEFAULT_SETTINGS, type PageSnapshot } from '../src/shared/types';

vi.mock('../src/shared/providers', () => ({
  callJevProvider: vi.fn(),
  activeJevModel: () => 'mock',
}));
vi.mock('../src/shared/planner', () => ({ planWithChatAI: vi.fn() }));
const jev = vi.mocked(callJevProvider);
const planner = vi.mocked(planWithChatAI);

function page(text: string): PageSnapshot {
  return {
    url: 'https://example.com/app', title: 'Task app', text,
    w: 900, h: 640, scroll: { y: 0, height: 640 },
    actions: [
      { id: 'button', node: 1, kind: 'click', role: 'button', label: 'Run step' },
      { id: 'wait', kind: 'wait', label: 'Wait' },
    ], omitted_actions: 0,
  };
}
function choice(name: 'CLICK' | 'DONE' | 'BLOCKED') {
  return { model: 'mock', answers: {
    operation: { choice: name, confidence: .95, probabilities: { [name]: .95, ...(name === 'DONE' ? { CLICK: .05 } : { DONE: .05 }) } },
    click_target: { choice: '1', confidence: .9, probabilities: { '1': 1 } },
    goal_done: { type: 'noul', noul: name === 'DONE' ? .92 : .1 },
    stuck: { type: 'noul', noul: name === 'BLOCKED' ? .91 : .1 },
  } };
}
describe('P1 ReAct micro-goals and replanning in AgentRunner', () => {
  let snapshot: PageSnapshot;
  let stage: number;
  let actions: number;
  beforeEach(() => {
    vi.resetAllMocks();
    snapshot = page('Initial page');
    stage = 0;
    actions = 0;
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => ({ id: 7, url: snapshot.url, status: 'complete' })),
        update: vi.fn(async () => ({})),
        sendMessage: vi.fn(async (_id: number, msg: any) => {
          if (msg.type === 'PING') return { pong: true };
          if (msg.type === 'CONTENT_OBSERVE') return { success: true, snapshot };
          if (msg.type === 'CONTENT_ACT') {
            actions++;
            snapshot = page('Stage ' + (++stage) + ' completed');
            return { ok: true, via: 'synthetic' };
          }
          return { ok: true };
        }),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        onCreated: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
      },
      storage: { local: { get: vi.fn(async () => ({ lumi_ai: { kind: 'chrome' } })) },
        session: {
          get: vi.fn(async () => ({ lumi_task_context_v2: [] })),
          set: vi.fn(async () => undefined)
        } },
      scripting: { executeScript: vi.fn() },
      runtime: { sendMessage: vi.fn(async () => undefined) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('executes two planned micro-goals and only reports DONE after observable changes', async () => {
    planner.mockResolvedValue({ intent: 'browser_task',
      subgoals: ['Run the first step', 'Run the second step'], successCriteria: 'Both stages completed' });
    jev.mockImplementation(async (_settings, request) => {
      const task = request.state.task;
      if (task.includes('first')) return choice(stage >= 1 ? 'DONE' : 'CLICK');
      if (task.includes('second')) return choice(stage >= 2 ? 'DONE' : 'CLICK');
      return choice('BLOCKED');
    });
    const runner = new AgentRunner();
    runner.setSettings({ ...DEFAULT_SETTINGS, trustedInput: false, stepDelayMs: 0, maxSteps: 8 });
    await runner.start('Complete both stages in this application', 7);
    expect(runner.getProgress().status, JSON.stringify(runner.getProgress())).toBe('done');
    expect(actions).toBe(2);
    expect(runner.getProgress().plan?.activeIndex).toBe(1);
    expect(runner.getProgress().logs.filter(l => l.operation === 'SUBGOAL_VERIFIED')).toHaveLength(1);
    expect(runner.getProgress().verification?.ok).toBe(true);
    expect(planner).toHaveBeenCalledOnce();
  });

  it('keeps the planner failure reason even after generic verification finishes', async () => {
    planner.mockRejectedValueOnce(new Error('Invalid JSON from Chat AI planner'));
    jev.mockImplementation(async () => choice(stage === 0 ? 'CLICK' : 'DONE'));
    const runner = new AgentRunner();
    runner.setSettings({ ...DEFAULT_SETTINGS, trustedInput: false, stepDelayMs: 0, maxSteps: 8 });
    await runner.start('Open the first result', 7);
    expect(runner.getProgress().status).toBe('done');
    expect(runner.getProgress().plan?.source).toBe('fallback');
    expect(runner.getProgress().plannerFailure).toContain('Invalid JSON');
    expect(runner.getProgress().verification?.ok).toBe(true);
    expect(runner.getProgress().logs.some(log => log.operation === 'PLAN (fallback)')).toBe(true);
  });

  it('replans once after a genuine BLOCKED and then completes a fresh subgoal', async () => {
    planner.mockResolvedValueOnce({
      intent: 'browser_task', subgoals: ['Try the first route'], successCriteria: 'Results ready'
    }).mockResolvedValueOnce({
      intent: 'browser_task', subgoals: ['Run fallback route'], successCriteria: 'Results ready'
    });
    jev.mockImplementation(async (_settings, request) => {
      if (request.state.task.includes('first route')) return choice('BLOCKED');
      return choice(stage === 0 ? 'CLICK' : 'DONE');
    });
    const runner = new AgentRunner();
    runner.setSettings({ ...DEFAULT_SETTINGS, trustedInput: false, stepDelayMs: 0, maxSteps: 8 });
    await runner.start('Try the route and find results', 7);
    expect(runner.getProgress().status, JSON.stringify(runner.getProgress())).toBe('done');
    expect(runner.getProgress().replans).toBe(1);
    expect(runner.getProgress().plannerCalls).toBe(1);
    expect(planner).toHaveBeenCalledTimes(2);
    expect(actions).toBe(1);
  });
});
