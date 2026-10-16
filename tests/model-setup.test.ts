import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SystemOneRequest } from 'ollama';
import { DEFAULT_LAYA_MODEL } from '../server/laya';
import { prepareLayaModel } from '../server/modelSetup';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

async function setup() {
  const calls: string[] = [];
  const behavior = { showStatus: 200, pullFails: false, inferenceFails: false, invalidScores: false };
  const server = Fastify(); servers.push(server);
  server.addHook('onRequest', async (request) => { calls.push(request.url); });
  server.post<{ Body: { model: string } }>('/api/show', async (request, reply) => {
    expect(request.body.model).toBe(DEFAULT_LAYA_MODEL);
    return behavior.showStatus === 200 ? {} : reply.code(behavior.showStatus).send({ error: 'show failed' });
  });
  server.post<{ Body: { name: string; stream: boolean } }>('/api/pull', async (request, reply) => {
    expect(request.body).toMatchObject({ name: DEFAULT_LAYA_MODEL, stream: true });
    const progress = [{ status: 'pulling manifest' },
      behavior.pullFails ? { error: 'download interrupted' } : { status: 'success' }];
    return reply.type('application/x-ndjson').send(progress.map((part) => JSON.stringify(part)).join('\n') + '\n');
  });
  server.post<{ Body: SystemOneRequest }>('/v1/systemone', async (request, reply) => {
    expect(request.body).toMatchObject({ model: DEFAULT_LAYA_MODEL, keep_alive: -1 });
    if (behavior.inferenceFails) return reply.code(500).send({ error: 'MLX runtime unavailable' });
    return { model: DEFAULT_LAYA_MODEL, answers: { phrase: { type: 'choice', choice: 'a',
      probabilities: behavior.invalidScores ? { a: 1, b: 1 } : { a: 0.6, b: 0.4 }, confidence: 0.2 } },
    usage: { input_tokens: 30, output_tokens: 1 } };
  });
  const host = await server.listen({ host: '127.0.0.1', port: 0 });
  const log = vi.fn();
  const run = () => prepareLayaModel({ host, model: DEFAULT_LAYA_MODEL, timeoutMs: 5000 }, log);
  return { behavior, calls, log, run };
}

describe('model initialization through the real Ollama SDK', () => {
  it('uses the cached model without a registry pull and still verifies inference', async () => {
    const { run, calls, log } = await setup();
    await run();
    expect(calls).toEqual(['/api/show', '/v1/systemone']);
    expect(log).toHaveBeenLastCalledWith({ event: 'model.ready', model: DEFAULT_LAYA_MODEL });
  });

  it('downloads a missing model before checking real inference', async () => {
    const { behavior, run, calls, log } = await setup(); behavior.showStatus = 404;
    await run();
    expect(calls).toEqual(['/api/show', '/api/pull', '/v1/systemone']);
    expect(log).toHaveBeenLastCalledWith({ event: 'model.ready', model: DEFAULT_LAYA_MODEL });
  });

  it('fails on a server error without treating it as a missing model', async () => {
    const { behavior, run, calls } = await setup(); behavior.showStatus = 503;
    await expect(run()).rejects.toThrow('show failed');
    expect(calls).toEqual(['/api/show']);
  });

  it('fails on an interrupted download without reporting readiness', async () => {
    const { behavior, run, calls, log } = await setup(); behavior.showStatus = 404; behavior.pullFails = true;
    await expect(run()).rejects.toThrow('download interrupted');
    expect(calls).toEqual(['/api/show', '/api/pull']);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'model.ready' }));
  });

  it.each(['inferenceFails', 'invalidScores'] as const)('refuses to start Web when %s', async (failure) => {
    const { behavior, run, log } = await setup(); behavior[failure] = true;
    await expect(run()).rejects.toThrow();
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'model.ready' }));
  });
});
