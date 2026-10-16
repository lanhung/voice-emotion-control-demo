import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemOneRequest } from 'ollama';
import { buildApp } from '../server/app';
import { CatalogError } from '../server/reactionCatalog';
import { createLayaScorer, DEFAULT_LAYA_MODEL, readLayaConfig, validateLayaResponse } from '../server/laya';
import { encodeWav } from '../src/audio/wav';
import { defaultCatalog, header, request } from './reaction-fixtures';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((app) => app.close())); });
const validOutput = (ids: string[]) => ({ model: DEFAULT_LAYA_MODEL,
  answers: { phrase: { type: 'choice', choice: ids[0], probabilities: Object.fromEntries(ids.map((id) => [id, 1 / ids.length])), confidence: 0.1 } },
  usage: { input_tokens: 100, output_tokens: 1 } });
async function setup(timeoutMs = 1000) {
  const calls: SystemOneRequest[] = [];
  const behavior = { status: 200, delayMs: 0, disconnected: 0, malformed: false, patch: (value: unknown): unknown => value };
  const upstream = Fastify(); servers.push(upstream);
  upstream.get('/health', async () => ({ ready: true }));
  upstream.addContentTypeParser(/^multipart\//, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  upstream.post('/api/v1/asr', async () => ({ result: [{ raw_text: '<|zh|><|NEUTRAL|><|Speech|>语音识别继续工作。' }] }));
  upstream.post<{ Body: SystemOneRequest }>('/v1/systemone', async (request, reply) => {
    calls.push(request.body);
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) behavior.disconnected++; });
    if (behavior.delayMs) await delay(behavior.delayMs);
    if (behavior.status !== 200) return reply.code(behavior.status).send({ error: 'upstream private detail' });
    if (behavior.malformed) return reply.type('application/json').send('{broken');
    const question = request.body.questions.phrase;
    if (question.type !== 'choice') throw new Error('Expected choice');
    return behavior.patch(validOutput(Object.keys(question.criteria)));
  });
  const host = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const config = { host, model: DEFAULT_LAYA_MODEL, timeoutMs };
  const app = await buildApp({ logger: false, staticDir: '/nonexistent', sensevoiceUrl: host,
    reaction: { layaConfig: config, random: () => 0 } }); servers.push(app);
  let sequence = 0;
  const post = (patch: Partial<ReturnType<typeof request>> = {}) => {
    sequence++;
    return app.inject({ method: 'POST', url: '/api/reaction/decision', payload: request({ sequence, turnId: `turn-${sequence}`, ...patch }) });
  };
  return { app, behavior, calls, post, config };
}

describe('decision API using the actual Ollama SDK and a controlled HTTP upstream', () => {
  it('calls /v1/systemone with only emotion and CSV candidates and returns a final phrase', async () => {
    const { post, calls, app } = await setup();
    expect((await post()).json()).toMatchObject({ reason: 'unstable_emotion' });
    const response = await post(); const result = response.json();
    expect(result).toMatchObject({ status: 'replied', text: "I'm here.", phraseId: 'support_here', decisionId: 'turn-2', displayMs: 2500, animationGapMs: 5000 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toBe(result.requestId);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: DEFAULT_LAYA_MODEL, state: { emotion: 'sad', recentEmotions: ['sad', 'sad'] },
      questions: { phrase: { type: 'choice', criteria: { support_here: "I'm here.", support_with_you: 'With you.', support_understand: 'I understand.' } } } });
    for (const key of ['messages', 'temperature', 'stream', 'text', 'audio']) expect(calls[0]).not.toHaveProperty(key);
    for (const key of ['probabilities', 'weights', 'modelOutput', 'recentCount']) expect(result).not.toHaveProperty(key);
    expect((await post({ turnId: 'turn-2', sequence: 2 })).json()).toEqual(result);
    const ack = { clientId: result.clientId, sessionId: result.sessionId, generation: result.generation, decisionId: result.decisionId };
    expect((await app.inject({ method: 'POST', url: '/api/reaction/displayed', payload: ack })).json()).toMatchObject({ status: 'accepted' });
    expect((await app.inject({ method: 'POST', url: '/api/reaction/displayed', payload: ack })).json()).toMatchObject({ status: 'duplicate' });
    expect(calls).toHaveLength(1);
  });
  it('rejects extra data, cross-origin writes, malformed JSON and the removed route', async () => {
    const { app, calls } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/reaction/decision', payload: { ...request(), text: 'private' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/reaction/decision', payload: request(), headers: { origin: 'https://unrelated.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/reaction/decision', payload: '{', headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/reaction', payload: request() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/reaction/displayed', payload: { clientId: 'client', sessionId: 'session', generation: 0, decisionId: 'unknown' } })).statusCode).toBe(409);
    expect(calls).toHaveLength(0);
  });
  it.each([[404, 'model_not_found'], [429, 'busy'], [500, 'decision_unavailable'], [413, 'context_overflow']])('maps upstream HTTP %s without leaking the error body', async (status, code) => {
    const { post, behavior } = await setup(); behavior.status = Number(status); await post();
    const response = await post(); expect(response.json()).toMatchObject({ status: 'error', code });
    expect(response.body).not.toContain('private detail');
  });
  it.each(['invalid-json', 'invalid-schema'])('rejects %s from the SDK response', async (mode) => {
    const { post, behavior } = await setup();
    if (mode === 'invalid-json') behavior.malformed = true; else behavior.patch = () => ({ model: 'wrong' });
    await post(); expect((await post()).json()).toMatchObject({ code: 'invalid_model_output' });
  });
  it('reports a network failure through the adapter', async () => {
    const scorer = createLayaScorer({ host: 'http://127.0.0.1:1', model: DEFAULT_LAYA_MODEL, timeoutMs: 1000 });
    await expect(scorer({ emotion: 'sad', recentEmotions: ['sad'], candidates: defaultCatalog.phrases.slice(0, 2) }, new AbortController().signal)).rejects.toMatchObject({ code: 'decision_unavailable' });
  });
  it('times out and closes the current SDK transport', async () => {
    const { post, behavior } = await setup(30); behavior.delayMs = 150; await post();
    const response = await post(); expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ code: 'decision_timeout' });
    await vi.waitFor(() => expect(behavior.disconnected).toBe(1));
  });
  it('propagates browser disconnection through Fastify to the SDK', async () => {
    const { app, post, behavior, calls } = await setup(); behavior.delayMs = 200; await post();
    const host = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const pending = fetch(`${host}/api/reaction/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request({ sequence: 2, turnId: 'cancel' })), signal: controller.signal }).catch(() => null);
    await vi.waitFor(() => expect(calls).toHaveLength(1)); controller.abort(); await pending;
    await vi.waitFor(() => expect(behavior.disconnected).toBe(1));
  });
  it('isolates cancellation between simultaneous SDK clients', async () => {
    const { config, behavior, calls } = await setup(); behavior.delayMs = 100;
    const scorer = createLayaScorer(config); const abort = new AbortController();
    const input = { emotion: 'sad' as const, recentEmotions: [], candidates: defaultCatalog.phrases.slice(0, 2) };
    const one = scorer(input, abort.signal).catch(() => 'cancelled');
    const two = scorer(input, new AbortController().signal);
    await vi.waitFor(() => expect(calls).toHaveLength(2)); abort.abort();
    expect(await one).toBe('cancelled'); expect(await two).toHaveProperty('probabilities');
  });
  it('keeps health and recognition working with an invalid catalog', async () => {
    const { config } = await setup();
    const app = await buildApp({ logger: false, staticDir: '/nonexistent', sensevoiceUrl: config.host,
      reaction: { catalog: new CatalogError('catalog_invalid', 'catalog.csv:3 [weight]: invalid weight') } }); servers.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/reaction/decision', payload: request() });
    expect(response.statusCode).toBe(503); expect(response.json().error).toContain('catalog.csv:3 [weight]');
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    const audio = Buffer.from(encodeWav(new Float32Array(16000)));
    const recognition = await app.inject({ method: 'POST', url: '/api/analyze', headers: { 'content-type': 'audio/wav' }, payload: audio });
    expect(recognition.json()).toMatchObject({ emotion: 'neutral', isSpeech: true });
  });
  it('loads CSV once per service and uses edited phrases after restart without a browser catalog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aura-catalog-'));
    const path = join(directory, 'phrases.csv');
    try {
      await writeFile(path, `${header}\nx,Here.,sad,1,0,true`);
      const start = async () => {
        const app = await buildApp({ logger: false, staticDir: '/nonexistent', reaction: { catalogPath: path } });
        servers.push(app); return app;
      };
      const decide = async (app: FastifyInstance, clientId: string) => {
        await app.inject({ method: 'POST', url: '/api/reaction/decision', payload: request({ clientId }) });
        return (await app.inject({ method: 'POST', url: '/api/reaction/decision', payload: request({ clientId, sequence: 2, turnId: 'second' }) })).json();
      };
      const original = await start(); expect(await decide(original, 'before')).toMatchObject({ text: 'Here.' });
      await writeFile(path, `${header}\nx,Stay close.,sad,1,0,true`);
      expect(await decide(original, 'unchanged')).toMatchObject({ text: 'Here.' });
      const restarted = await start(); expect(await decide(restarted, 'after')).toMatchObject({ text: 'Stay close.' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('runtime probability validation', () => {
  it.each([
    { model: 'wrong' }, { answers: {} }, { answers: { phrase: { type: 'score' } } },
    { answers: { phrase: { type: 'choice', choice: 'other', probabilities: { a: 0.5, b: 0.5 }, confidence: 1 } } },
    ...[{ a: 1 }, { a: 0.5, b: 0.5, c: 0 }, { a: 0, b: 0 }, { a: 1.1, b: -0.1 }, { a: NaN, b: 0.5 }, { a: 0.1, b: 0.1 }]
      .map((probabilities) => ({ answers: { phrase: { type: 'choice', choice: 'a', probabilities, confidence: 0 } } })),
  ])('rejects invalid response %j', (patch) => {
    expect(() => validateLayaResponse({ ...validOutput(['a', 'b']), ...patch }, DEFAULT_LAYA_MODEL, ['a', 'b'])).toThrow();
  });
  it('normalizes floating-point tolerance without using confidence as an emotion threshold', () => {
    const output = validOutput(['a', 'b']); output.answers.phrase.probabilities = { a: 0.50001, b: 0.5 }; output.answers.phrase.confidence = 0;
    expect(validateLayaResponse(output, DEFAULT_LAYA_MODEL, ['a', 'b']).probabilities.a).toBeCloseTo(0.5);
  });
});

it.skipIf(process.env.LIVE_LAYA_TEST !== 'true')('uses the deployed Laya through the production SDK adapter', async () => {
  const scorer = createLayaScorer(readLayaConfig());
  const candidates = defaultCatalog.phrases.filter((phrase) => phrase.enabled && phrase.emotions.includes('sad'));
  const result = await scorer({ emotion: 'sad', recentEmotions: ['sad', 'sad'], candidates }, new AbortController().signal);
  expect(candidates.map((phrase) => phrase.id)).toContain(result.choice);
  expect(Object.keys(result.probabilities).sort()).toEqual(candidates.map((phrase) => phrase.id).sort());
}, 15_000);
