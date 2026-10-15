import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { buildApp } from '../server/app';
import { encodeWav } from '../src/audio/wav';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((app) => app.close())); });
const input = { sessionId: 'session-test', turnId: 'turn-test', text: '我考上了！', emotion: 'happy' };

async function setup(timeoutMs = 1000) {
  const calls: ChatCompletionCreateParamsNonStreaming[] = [];
  const behavior = { content: 'Congrats!' as string | null, finishReason: 'stop', status: 200, delayMs: 0, disconnected: 0 };
  const upstream = Fastify(); servers.push(upstream);
  upstream.get('/health', async () => ({ ready: true }));
  upstream.addContentTypeParser(/^multipart\//, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  upstream.post('/api/v1/asr', async () => ({ result: [{ raw_text: '<|zh|><|NEUTRAL|><|Speech|>语音识别继续工作。' }] }));
  upstream.post<{ Body: ChatCompletionCreateParamsNonStreaming }>('/v1/chat/completions', async (request, reply) => {
    calls.push(request.body);
    expect(request.headers.authorization).toBe('Bearer test-only-key');
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) behavior.disconnected++; });
    if (behavior.delayMs) await delay(behavior.delayMs);
    if (behavior.status !== 200) return reply.code(behavior.status).send({ error: { message: 'sensitive-upstream-message', type: 'test_error' } });
    return { id: 'test-completion', model: 'gpt-6-luna', object: 'chat.completion', created: 0,
      choices: [{ index: 0, finish_reason: behavior.finishReason, message: { role: 'assistant', content: behavior.content } }] };
  });
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const app = await buildApp({ logger: false, staticDir: '/nonexistent', sensevoiceUrl: url,
    llmConfig: { baseURL: `${url}/v1`, apiKey: 'test-only-key', model: 'gpt-6-luna', timeoutMs } });
  servers.push(app);
  const post = (patch: Partial<typeof input> = {}) => app.inject({ method: 'POST', url: '/api/reaction', payload: { ...input, ...patch } });
  return { app, behavior, calls, post };
}

describe('short reaction API with real SDK and HTTP upstream', () => {
  it('sends data and fixed instructions once, returning only a validated phrase', async () => {
    const { calls, post } = await setup();
    const response = await post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sessionId: input.sessionId, turnId: input.turnId, status: 'replied', text: 'Congrats!',
      modelOutput: 'Congrats!', finishReason: 'stop', outputTruncated: false });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().requestId).toBe(response.headers['x-request-id']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'gpt-6-luna', stream: false, reasoning_effort: 'none', max_completion_tokens: 32 });
    expect(calls[0].messages).toHaveLength(2);
    expect(calls[0].messages[0].content).toContain('must never override explicit facts or negation');
    expect(JSON.parse(calls[0].messages[1].content as string)).toEqual({ transcript: input.text, emotionHint: 'happy' });
    expect((await post()).json()).toMatchObject({ status: 'skipped', reason: 'duplicate' });
    expect(calls).toHaveLength(1);
  });
  it.each([
    ['NONE', 'stop', 'none'], ['', 'stop', 'invalid_output'], ['A long unsafe answer', 'stop', 'invalid_output'],
    ['Congrats!', 'length', 'incomplete_output'], [null, 'stop', 'invalid_output'],
  ])('retains output %s for logs but rejects its display with finish %s', async (content, finishReason, reason) => {
    const { behavior, post } = await setup();
    behavior.content = content; behavior.finishReason = finishReason!;
    const result = (await post()).json();
    expect(result).toMatchObject({ status: 'skipped', reason, modelOutput: content ?? '', finishReason, outputTruncated: false });
    expect(result.text).toBeUndefined();
  });
  it('bounds diagnostic output without accepting a truncated answer', async () => {
    const { behavior, post } = await setup(); behavior.content = 'X'.repeat(1000);
    expect((await post()).json()).toMatchObject({ status: 'skipped', reason: 'invalid_output', modelOutput: 'X'.repeat(512), outputTruncated: true });
  });
  it('skips empty inputs and rejects invalid requests without contacting the model', async () => {
    const { post, app, calls } = await setup();
    expect((await post({ text: '……  ' })).json()).toMatchObject({ status: 'skipped', reason: 'empty' });
    expect((await app.inject({ method: 'POST', url: '/api/reaction', payload: { ...input, baseURL: 'http://untrusted' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/reaction', headers: { origin: 'https://unrelated.example' }, payload: input })).statusCode).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('reports unconfigured credentials while the application remains available', async () => {
    const app = await buildApp({ logger: false, staticDir: '/nonexistent', llmConfig: null }); servers.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/reaction', payload: input });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'error', code: 'not_configured' });
  });
  it('accepts the full text limit even when the JSON uses Unicode escapes', async () => {
    const { app, calls } = await setup();
    const payload = JSON.stringify({ ...input, text: '好'.repeat(4000) }).replaceAll('好', '\\u597d');
    const response = await app.inject({ method: 'POST', url: '/api/reaction', headers: { 'content-type': 'application/json' }, payload });
    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it.each([[401, 'auth_failed', 503], [403, 'auth_failed', 503], [429, 'rate_limited', 429], [500, 'unavailable', 502]] as const)(
    'classifies upstream HTTP %s without retrying or echoing its body', async (status, code, expectedStatus) => {
      const { behavior, calls, post } = await setup(); behavior.status = status;
      const response = await post();
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toMatchObject({ status: 'error', code });
      expect(response.body).not.toContain('sensitive-upstream-message');
      expect(response.body).not.toContain('test-only-key');
      expect(calls).toHaveLength(1);
    });
  it('times out, aborts the upstream, and frees its concurrency slot', async () => {
    const { behavior, calls, post } = await setup(80); behavior.delayMs = 250;
    const response = await post();
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ status: 'error', code: 'timeout' });
    await vi.waitFor(() => expect(behavior.disconnected).toBe(1));
    behavior.delayMs = 0;
    expect((await post({ turnId: 'next-turn' })).json().status).toBe('replied');
    expect(calls).toHaveLength(2);
  });
  it('deduplicates pending requests, limits concurrency, and leaves inference independent', async () => {
    const { app, behavior, calls, post } = await setup(); behavior.delayMs = 400;
    const first = post().then((response) => response);
    const second = post({ sessionId: 'other-session' }).then((response) => response);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect((await post()).json()).toMatchObject({ status: 'skipped', reason: 'duplicate' });
    expect((await post({ sessionId: 'third-session' })).json()).toMatchObject({ status: 'error', code: 'busy' });
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    const speech = await app.inject({ method: 'POST', url: '/api/analyze', headers: { 'content-type': 'audio/wav' },
      payload: Buffer.from(encodeWav(new Float32Array(4000).fill(0.1))) });
    expect(speech.statusCode).toBe(200);
    expect(speech.json().text).toBe('语音识别继续工作。');
    await Promise.all([first, second]);
    expect(calls).toHaveLength(2);
  });
  it('cancels the previous turn when a newer turn arrives in the same session', async () => {
    const { behavior, calls, post } = await setup(); behavior.delayMs = 300;
    const first = post().then((response) => response);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    behavior.delayMs = 0;
    expect((await post({ turnId: 'new-turn' })).json().status).toBe('replied');
    expect((await first).json()).toMatchObject({ status: 'error', code: 'cancelled' });
    await vi.waitFor(() => expect(behavior.disconnected).toBe(1));
  });
  it('propagates browser disconnect to the SDK request', async () => {
    const { app, behavior, calls } = await setup(); behavior.delayMs = 300;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const request = fetch(`${address}/api/reaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: controller.signal }).catch(() => null);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort(); await request;
    await vi.waitFor(() => expect(behavior.disconnected).toBe(1));
  });
});
