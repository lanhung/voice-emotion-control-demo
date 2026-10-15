import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { recognize, wavDuration } from './sensevoice';
import type { HealthResponse } from '../shared/emotions';
import { measureSignal } from '../shared/monitoring';
import { registerReactionRoutes } from './reactionRoutes';
import type { LlmConfig } from './llm';

interface AppOptions { sensevoiceUrl?: string; logger?: boolean; staticDir?: string; llmConfig?: LlmConfig | null }

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    logController: new LogController({ disableRequestLogging: true }), genReqId: () => randomUUID(), bodyLimit: 160_044, requestTimeout: 45_000 });
  const sensevoiceUrl = (options.sensevoiceUrl ?? process.env.SENSEVOICE_URL ?? 'http://127.0.0.1:50000').replace(/\/$/, '');
  let inFlight = 0;
  let healthState = 'unknown';
  const logTranscripts = process.env.LOG_TRANSCRIPTS === 'true';

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  });
  app.addHook('onRequest', async (request, reply) => {
    // This is a local demo; reject cross-origin mutation requests without login overhead.
    const origin = request.headers.origin;
    if (request.method === 'POST' && origin) {
      let valid = false;
      try {
        const parsed = new URL(origin);
        valid = parsed.host === request.headers.host || (process.env.NODE_ENV !== 'production' &&
          ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(parsed.origin));
      } catch { /* reject below */ }
      if (!valid) {
        request.log.warn({ event: 'request.rejected', reason: 'cross_origin' }, 'Rejected cross-origin request');
        return reply.code(403).send({ error: '不接受跨站请求。' });
      }
    }
  });
  app.addContentTypeParser('audio/wav', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.get('/api/health', async (request, reply): Promise<HealthResponse> => {
    reply.header('Cache-Control', 'no-store');
    try {
      const result = await fetch(`${sensevoiceUrl}/health`, { signal: AbortSignal.timeout(2500) });
      const body = await result.json() as { ready?: boolean };
      if (!result.ok || !body.ready) throw new Error('Not ready');
      if (healthState !== 'ready') request.log.info({ event: 'model.ready', previous: healthState }, 'SenseVoice is ready');
      healthState = 'ready';
      return { status: 'ready', model: 'SenseVoiceSmall', intervalMs: 2500 };
    } catch (error) {
      if (healthState !== 'unavailable') request.log.warn({ event: 'model.unavailable', reason: error instanceof Error ? error.message : 'Unknown' }, 'SenseVoice is unavailable');
      healthState = 'unavailable';
      reply.code(503);
      return { status: 'unavailable', model: 'SenseVoiceSmall', intervalMs: 2500 };
    }
  });

  app.post<{ Body: Buffer }>('/api/analyze', { schema: { headers: {
    type: 'object', properties: {
      'x-aura-session': { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
      'x-aura-sequence': { type: 'string', pattern: '^[0-9]{1,7}$' },
    },
  } } }, async (request, reply) => {
    const started = performance.now();
    const trace = { requestId: request.id, sessionId: String(request.headers['x-aura-session'] ?? 'untracked'),
      sequence: Number(request.headers['x-aura-sequence'] ?? 0), receivedAt: new Date().toISOString() };
    const log = request.log.child(trace);
    reply.header('X-Request-Id', request.id);
    reply.header('Cache-Control', 'no-store');
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: '请提交 WAV 音频。' });
    try { wavDuration(request.body); }
    catch {
      log.warn({ event: 'audio.rejected', audioBytes: request.body.length, reason: 'invalid_wav' }, 'Invalid audio window');
      return reply.code(400).send({ error: '需要 0.1–5 秒、16 kHz 单声道 PCM16 WAV 音频。' });
    }
    const samples = new Float32Array((request.body.length - 44) / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = request.body.readInt16LE(44 + i * 2) / 32768;
    log.info({ event: 'audio.received', audioBytes: request.body.length, durationMs: samples.length / 16,
      sampleRate: 16000, ...measureSignal(samples), inFlight }, 'Audio window received');
    if (inFlight >= 2) {
      log.warn({ event: 'audio.rejected', reason: 'busy', inFlight }, 'Inference concurrency limit reached');
      return reply.code(429).header('Retry-After', '2').send({ error: '模型正在处理，请稍后重试。' });
    }

    inFlight++;
    const controller = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableEnded) { log.warn({ event: 'request.cancelled' }, 'Browser disconnected'); controller.abort(); }
    };
    reply.raw.on('close', onClose);
    try {
      const result = await recognize(request.body, sensevoiceUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), trace,
        (event, fields) => log.info({ event, ...fields }, event));
      const serverMs = Math.round(performance.now() - started);
      log.info({ event: 'recognition.completed', tags: result.tags, emotionTag: result.emotionTag, emotion: result.emotion,
        language: result.language, isSpeech: result.isSpeech, events: result.events, textLength: result.text.length,
        latencyMs: result.latencyMs, serverMs, ...result.inference,
        ...(logTranscripts ? { text: result.text } : {}) }, 'Emotion and transcription completed');
      return { ...result, trace: { ...trace, serverMs } };
    } catch (error) {
      log.error({ event: 'recognition.failed', errorType: error instanceof Error ? error.name : 'Unknown',
        reason: error instanceof Error ? error.message : 'Unknown', elapsedMs: Math.round(performance.now() - started) }, 'SenseVoice request failed');
      return reply.code(502).send({ error: '本地语音模型暂时不可用，请稍后重试。', requestId: request.id });
    } finally {
      inFlight--;
      reply.raw.removeListener('close', onClose);
    }
  });

  registerReactionRoutes(app, options.llmConfig);

  const root = options.staticDir ?? resolve('dist/client');
  if (existsSync(root)) {
    await app.register(fastifyStatic, { root, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html', { cacheControl: false });
    });
  }
  return app;
}
