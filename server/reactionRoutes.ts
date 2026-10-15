import type { FastifyInstance } from 'fastify';
import { createReactionGenerator, readLlmConfig, ReactionError, type LlmConfig } from './llm';
import { reactionRequestSchema, type ReactionDecision } from './reaction';
import type { ReactionErrorCode, ReactionResponse } from '../shared/reaction';

const DEDUPE_TTL_MS = 5 * 60_000;
const MAX_REMEMBERED_TURNS = 512;
const MAX_CONCURRENT_REACTIONS = 2;

export function registerReactionRoutes(app: FastifyInstance, config: LlmConfig | null = readLlmConfig()) {
  const generate = createReactionGenerator(config);
  const active = new Map<string, AbortController>();
  const seen = new Map<string, number>();
  app.addHook('preClose', async () => { for (const controller of active.values()) controller.abort(); });

  app.post('/api/reaction', { bodyLimit: 32_768 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Request-Id', request.id);
    const parsed = reactionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: 'error', code: 'invalid_request',
      error: '短回应请求格式不正确，文字最多 4000 字。', requestId: request.id });
    const input = parsed.data;
    const started = performance.now();
    const trace = { requestId: request.id, sessionId: input.sessionId, turnId: input.turnId };
    const log = request.log.child(trace);
    const finish = (result: ReactionDecision | { status: 'error'; code: ReactionErrorCode; error: string }): ReactionResponse => {
      const latencyMs = Math.round(performance.now() - started);
      log.info({ event: 'reaction.completed', status: result.status,
        ...(result.status === 'skipped' ? { reason: result.reason } : result.status === 'error' ? { code: result.code } : {}),
        ...(result.status === 'replied' ? { text: result.text } : {}),
        ...(result.status !== 'error' ? { modelOutput: result.modelOutput,
          outputTruncated: result.outputTruncated, finishReason: result.finishReason } : {}),
        textLength: input.text.length, latencyMs }, 'Short reaction completed');
      return { ...trace, ...result, latencyMs };
    };
    const now = Date.now();
    for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
    const key = JSON.stringify([input.sessionId, input.turnId]);
    if (seen.has(key)) return finish({ status: 'skipped', reason: 'duplicate' });
    if (seen.size >= MAX_REMEMBERED_TURNS || (!active.has(input.sessionId) && active.size >= MAX_CONCURRENT_REACTIONS)) {
      return reply.code(429).header('Retry-After', '2').send(finish({ status: 'error', code: 'busy', error: '短回应正在处理，请稍后再试。' }));
    }
    seen.set(key, now + DEDUPE_TTL_MS);
    active.get(input.sessionId)?.abort();
    const controller = new AbortController();
    active.set(input.sessionId, controller);
    const onClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', onClose);
    try {
      if (!input.text.trim() || !/[\p{L}\p{N}]/u.test(input.text)) return finish({ status: 'skipped', reason: 'empty' });
      log.info({ event: 'reaction.started', textLength: input.text.length }, 'Short reaction requested');
      return finish(await generate({ ...input, text: input.text.trim() }, controller.signal));
    } catch (error) {
      const failure = error instanceof ReactionError ? error : new ReactionError('unavailable', 502, '短回应暂时不可用，可以继续聆听。');
      return reply.code(failure.statusCode).send(finish({ status: 'error', code: failure.code, error: failure.message }));
    } finally {
      reply.raw.removeListener('close', onClose);
      if (active.get(input.sessionId) === controller) active.delete(input.sessionId);
    }
  });
}
