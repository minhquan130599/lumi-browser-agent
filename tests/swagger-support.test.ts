import { describe, expect, it } from 'vitest';
import { suggestSwaggerGetOperation } from '../src/shared/swagger-support';
import type { PageAction } from '../src/shared/types';

const actions: PageAction[] = [
  { id: 'root', node: 1, role: 'button', kind: 'click', label: 'GET / Root' },
  { id: 'health', node: 2, role: 'button', kind: 'click', label: 'GET /v1 /health Health' },
  { id: 'voices', node: 3, role: 'button', kind: 'click', label: 'GET /v1 /voices Voices' },
  { id: 'voices-child', node: 4, role: 'button', kind: 'click', label: 'get \u200b/v1\u200b/voices' },
  { id: 'wait', kind: 'wait', label: 'Wait for the page to update' },
];

describe('safe Swagger endpoint discovery', () => {
  const docs = { title: 'VieNeu Remote TTS - Swagger UI', actions };

  it('finds the GET /v1/voices accordion for the Vietnamese voice-list goal', () => {
    const match = suggestSwaggerGetOperation(docs, 'test api lấy danh sách voice');
    expect(match?.path).toBe('/v1/voices');
    expect(match?.action.id).toBe('voices');
    expect(match?.hint).toContain('Try it out');
  });

  it('only matches the goal and does not click an unrelated route', () => {
    expect(suggestSwaggerGetOperation(docs, 'test api lấy danh sách health')?.action.id).toBe('health');
    expect(suggestSwaggerGetOperation(docs, 'test api lấy danh sách orders')).toBeNull();
  });

  it('rejects a site other than Swagger and never selects POST', () => {
    expect(suggestSwaggerGetOperation({ title: 'Banking', actions }, 'test api voice')).toBeNull();
    expect(suggestSwaggerGetOperation({
      title: 'Swagger UI',
      actions: [{ id: 'post', kind: 'click', node: 5, role: 'button', label: 'POST /v1/voices' }],
    }, 'test api voice')).toBeNull();
  });

  it('rejects ambiguous GET endpoints and an already opened accordion', () => {
    expect(suggestSwaggerGetOperation({
      title: 'Swagger UI',
      actions: [
        ...actions,
        { id: 'voice', kind: 'click', node: 6, role: 'button', label: 'GET /v1/voice' },
      ],
    }, 'test api voice')).toBeNull();
    expect(suggestSwaggerGetOperation({
      title: 'Swagger UI',
      actions: [
        ...actions.slice(0, 4),
        { id: 'try', kind: 'click', node: 7, role: 'button', label: 'Try it out' },
        { id: 'wait', kind: 'wait', label: 'Wait for the page to update' },
      ],
    }, 'test api voice')).toBeNull();
  });
});
