import type { FastifyInstance } from 'fastify';
import { displayedRequestSchema, reactionRequestSchema, type ReactionErrorCode } from '../shared/reaction';
import { createReactionService, type ReactionServiceOptions } from './reaction';

const errorStatus: Record<ReactionErrorCode, number> = {
  catalog_missing: 503, catalog_invalid: 503, invalid_configuration: 503, model_not_found: 503,
  decision_timeout: 504, decision_unavailable: 502, invalid_model_output: 502, context_overflow: 502,
  busy: 429, invalid_request: 400,
};
export async function registerReactionRoutes(app: FastifyInstance, options: ReactionServiceOptions = {}) {
  const service = await createReactionService({ ...options,
    log: options.log ?? ((event, fields) => app.log.info({ event, ...fields }, event)) });
  const sweep = setInterval(() => service.sweep(), 1000); sweep.unref();
  app.addHook('preClose', async () => { clearInterval(sweep); service.close(); });
  app.post('/api/reaction/decision', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Request-Id', request.id);
    const parsed = reactionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: 'error', code: 'invalid_request', error: '情绪决策请求格式不正确。', requestId: request.id });
    const controller = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', onClose);
    try {
      const result = await service.decide(parsed.data, controller.signal, request.id);
      reply.header('X-Request-Id', result.requestId);
      if (result.status === 'error') reply.code(errorStatus[result.code]);
      return result;
    } finally { reply.raw.removeListener('close', onClose); }
  });
  app.post('/api/reaction/displayed', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = displayedRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '展示回执格式不正确。' });
    const result = service.displayed(parsed.data);
    return reply.code(result.status === 'rejected' ? 409 : 200).send(result);
  });
}
