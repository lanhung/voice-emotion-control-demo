import OpenAI from 'openai';
import { z } from 'zod';
import { MAX_REACTION_OUTPUT_LENGTH, REACTION_TIMEOUT_MS, type ReactionErrorCode, type ReactionRequest } from '../shared/reaction';
import { reactionSystemPrompt, validateReaction, type ReactionDecision } from './reaction';

export interface LlmConfig { baseURL: string; apiKey: string; model: string; timeoutMs: number }
const configSchema = z.object({
  baseURL: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }),
  apiKey: z.string().trim().min(1), model: z.string().trim().min(1),
  timeoutMs: z.coerce.number().int().min(1000).max(30_000),
});

export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const result = configSchema.safeParse({ baseURL: env.LLM_BASE_URL ?? 'http://127.0.0.1:8317/v1',
    apiKey: env.LLM_API_KEY, model: env.LLM_MODEL ?? 'gpt-6-luna', timeoutMs: env.LLM_TIMEOUT_MS ?? REACTION_TIMEOUT_MS });
  return result.success ? result.data : null;
}

export class ReactionError extends Error {
  constructor(readonly code: ReactionErrorCode, readonly statusCode: number, message: string) { super(message); }
}

export function createReactionGenerator(config: LlmConfig | null) {
  const client = config ? new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey,
    timeout: config.timeoutMs, maxRetries: 0, logLevel: 'off' }) : null;
  return async (input: ReactionRequest, signal: AbortSignal): Promise<ReactionDecision> => {
    if (!client || !config) throw new ReactionError('not_configured', 503, '短回应尚未配置，请检查服务端模型设置。');
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const combined = AbortSignal.any([signal, deadline]);
    try {
      const completion = await client.chat.completions.create({
        model: config.model, stream: false, reasoning_effort: 'none', max_completion_tokens: 32,
        messages: [{ role: 'system', content: reactionSystemPrompt },
          { role: 'user', content: JSON.stringify({ transcript: input.text, emotionHint: input.emotion }) }],
      }, { signal: combined });
      combined.throwIfAborted();
      const choice = completion.choices?.[0];
      const content = choice?.message?.content;
      return { ...validateReaction(content, choice?.finish_reason, choice?.message?.refusal),
        modelOutput: typeof content === 'string' ? content.slice(0, MAX_REACTION_OUTPUT_LENGTH) : '',
        outputTruncated: typeof content === 'string' && content.length > MAX_REACTION_OUTPUT_LENGTH,
        finishReason: choice?.finish_reason ?? null };
    } catch (error) {
      if (signal.aborted) throw new ReactionError('cancelled', 409, '本轮短回应已取消。');
      if (deadline.aborted || error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new ReactionError('timeout', 504, '短回应等待超时，可以继续聆听。');
      }
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401 || error.status === 403) throw new ReactionError('auth_failed', 503, '短回应认证失败，请检查服务端密钥。');
        if (error.status === 429) throw new ReactionError('rate_limited', 429, '短回应服务繁忙，请稍后再试。');
      }
      // Upstream errors may echo prompts or credentials; never expose/log them.
      throw new ReactionError('unavailable', 502, '短回应暂时不可用，可以继续聆听。');
    }
  };
}
