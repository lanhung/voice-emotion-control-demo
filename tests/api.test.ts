import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildApp } from '../server/app';
import { encodeWav } from '../src/audio/wav';
import { defaultRecognitionOptions, type RecognitionOptions } from '../shared/recognition';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((app) => app.close())); });
const wav = Buffer.from(encodeWav(new Float32Array(40000).fill(0.1)));

async function setup(available = true, expectedOptions: RecognitionOptions = defaultRecognitionOptions) {
  const upstream = Fastify(); servers.push(upstream);
  upstream.addContentTypeParser(/^multipart\//, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  upstream.get('/health', (_request, reply) => available ? { ready: true } : reply.code(503).send({ ready: false }));
  upstream.post<{ Body: Buffer }>('/api/v1/asr', async (request, reply) => {
    if (!available) return reply.code(500).send({ error: 'test failure' });
    expect(request.body.includes(Buffer.from('RIFF'))).toBe(true);
    expect(request.body.includes(Buffer.from('name="files"'))).toBe(true);
    expect(request.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(request.headers['x-aura-session']).toBeDefined();
    const form = await new Response(new Uint8Array(request.body), { headers: { 'content-type': request.headers['content-type']! } }).formData();
    expect(form.get('lang')).toBe(expectedOptions.language);
    expect(form.get('ban_emo_unk')).toBe(String(expectedOptions.banUnknownEmotion));
    return { result: [{ raw_text: '<|zh|><|HAPPY|><|Speech|><|withitn|>你好，世界。' }],
      timings: { inferenceMs: 90, queueMs: 2 }, recognitionOptions: expectedOptions };
  });
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const app = await buildApp({ sensevoiceUrl: url, logger: false, staticDir: '/nonexistent' }); servers.push(app);
  return app;
}

describe('Node API', () => {
  it('proxies real multipart audio and returns normalized model output', async () => {
    const app = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: { 'content-type': 'audio/wav' }, payload: wav });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ text: '你好，世界。', emotion: 'happy', durationMs: 2500,
      recognitionOptions: { language: 'auto', banUnknownEmotion: true } });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('surfaces a disconnected model in both health and inference', async () => {
    const app = await setup(false);
    expect((await app.inject('/api/health')).statusCode).toBe(503);
    const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: { 'content-type': 'audio/wav' }, payload: wav });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toContain('暂时不可用');
  });
  it('rejects malformed audio and cross-origin requests', async () => {
    const app = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/analyze', headers: { 'content-type': 'audio/wav' }, payload: Buffer.from('not-a-wav') })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/analyze', headers: { 'content-type': 'audio/wav', origin: 'https://unrelated.example' }, payload: wav })).statusCode).toBe(403);
  });
  it('correlates a microphone session/window through the Node and model response', async () => {
    const app = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/analyze',
      headers: { 'content-type': 'audio/wav', 'x-aura-session': 'mic-session-test', 'x-aura-sequence': '12' }, payload: wav });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ emotionTag: 'HAPPY', tags: ['zh', 'HAPPY', 'Speech', 'withitn'],
      trace: { requestId: response.headers['x-request-id'], sessionId: 'mic-session-test', sequence: 12 },
      inference: { inferenceMs: 90, queueMs: 2 } });
    expect(response.json().trace.serverMs).toBeGreaterThanOrEqual(0);
  });

  it.each<RecognitionOptions>([{ language: 'zh', banUnknownEmotion: false }, { language: 'en', banUnknownEmotion: true }])(
    'forwards explicit settings to the model and accepts a full five-second window: %j', async (options) => {
      const app = await setup(true, options);
      const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: {
        'content-type': 'audio/wav', 'x-aura-language': options.language, 'x-aura-ban-emo-unk': String(options.banUnknownEmotion),
      }, payload: Buffer.from(encodeWav(new Float32Array(80000).fill(0.1))) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ durationMs: 5000, recognitionOptions: options });
    });

  it.each([['x-aura-language', 'fr'], ['x-aura-language', 'zh-CN'], ['x-aura-language', ''],
    ['x-aura-ban-emo-unk', 'yes'], ['x-aura-ban-emo-unk', '0']])('rejects unsupported %s=%s', async (header, value) => {
    const app = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/analyze',
      headers: { 'content-type': 'audio/wav', [header]: value }, payload: wav });
    expect(response.statusCode).toBe(400);
  });
});
