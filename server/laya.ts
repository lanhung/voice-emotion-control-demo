import { Ollama, type SystemOneRequest, type SystemOneResponse } from 'ollama';
import { z } from 'zod';
import type { Emotion } from '../shared/emotions';
import { MAX_EMOTION_CANDIDATES, type CatalogEmotion, type CatalogPhrase } from '../shared/reactionCatalog';
import { ReactionError } from './reactionError';

export const DEFAULT_LAYA_MODEL = 'laya:322m-multilingual-mlx-fp16';
export interface LayaConfig { host: string; model: string; timeoutMs: number }
const configSchema = z.object({
  host: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === '/';
  }),
  model: z.string().trim().min(1), timeoutMs: z.coerce.number().int().min(1000).max(10_000),
});
export function readLayaConfig(env: NodeJS.ProcessEnv = process.env): LayaConfig | null {
  const result = configSchema.safeParse({ host: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11435',
    model: env.LAYA_MODEL ?? DEFAULT_LAYA_MODEL, timeoutMs: env.LAYA_TIMEOUT_MS ?? 5000 });
  return result.success ? result.data : null;
}
export interface LayaInput { emotion: CatalogEmotion; recentEmotions: readonly Emotion[]; candidates: readonly CatalogPhrase[] }
export interface LayaScores { probabilities: Record<string, number>; choice: string; confidence: number; usage: SystemOneResponse['usage'] }
export type ScoreCandidates = (input: LayaInput, signal: AbortSignal) => Promise<LayaScores>;
const answerSchema = z.object({
  model: z.string(), answers: z.object({ phrase: z.object({ type: z.literal('choice'), choice: z.string(),
    probabilities: z.record(z.string(), z.number().finite().min(0).max(1)), confidence: z.number().finite() }).strict() }).strict(),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
export function validateLayaResponse(value: unknown, model: string, ids: readonly string[]): LayaScores {
  const parsed = answerSchema.safeParse(value);
  const invalid = () => new ReactionError('invalid_model_output', 502, 'Laya 返回了无效的候选评分。');
  if (!parsed.success || parsed.data.model !== model) throw invalid();
  const { phrase } = parsed.data.answers;
  const keys = Object.keys(phrase.probabilities);
  if (!ids.includes(phrase.choice) || keys.length !== ids.length || !ids.every((id) => Object.hasOwn(phrase.probabilities, id))) throw invalid();
  const sum = Object.values(phrase.probabilities).reduce((total, probability) => total + probability, 0);
  if (sum <= 0 || Math.abs(sum - 1) > 0.001) throw invalid();
  if (parsed.data.usage.input_tokens > 1024) throw new ReactionError('context_overflow', 502, 'Laya 输入超过配置的 1024 上下文限制。');
  return { probabilities: Object.fromEntries(ids.map((id) => [id, phrase.probabilities[id] / sum])),
    choice: phrase.choice, confidence: phrase.confidence, usage: parsed.data.usage };
}

export function createLayaScorer(config: LayaConfig | null = readLayaConfig()): ScoreCandidates {
  return async (input, signal) => {
    if (!config || typeof Ollama.prototype.systemone !== 'function') {
      throw new ReactionError('invalid_configuration', 503, '请检查 Ollama 地址、Laya 配置及 SDK 决策接口版本。');
    }
    if (input.candidates.length < 2 || input.candidates.length > MAX_EMOTION_CANDIDATES) {
      throw new ReactionError('invalid_configuration', 503, 'Laya 候选数量必须为 2–20 条。');
    }
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), config.timeoutMs);
    const combined = AbortSignal.any([signal, deadline.signal]);
    // A client per call isolates transport cancellation; SDK abort() only tracks streams.
    const client = new Ollama({ host: config.host, fetch: (url, options) => fetch(url, {
      ...options, signal: options?.signal ? AbortSignal.any([combined, options.signal]) : combined,
    }) });
    const request: SystemOneRequest = { model: config.model,
      state: { purpose: 'emotional companionship', emotion: input.emotion, recentEmotions: input.recentEmotions.slice(-3) },
      questions: { phrase: { type: 'choice', instructions: 'Choose supportive wording for this acoustic emotion. Do not infer events or intent.',
        criteria: Object.fromEntries(input.candidates.map((phrase) => [phrase.id, phrase.text])) } },
    };
    try {
      combined.throwIfAborted();
      const response: SystemOneResponse = await client.systemone(request);
      combined.throwIfAborted();
      return validateLayaResponse(response, config.model, input.candidates.map((phrase) => phrase.id));
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (deadline.signal.aborted) throw new ReactionError('decision_timeout', 504, 'Laya 候选评分超时，可以继续聆听。');
      if (error instanceof ReactionError) throw error;
      if (error instanceof SyntaxError) throw new ReactionError('invalid_model_output', 502, 'Laya 返回了无效的候选评分。');
      const status = error instanceof Error && 'status_code' in error ? error.status_code : undefined;
      if (status === 404) throw new ReactionError('model_not_found', 503, '未找到配置的 Laya 模型，请检查完整模型标签。');
      if (status === 413 || (status === 400 && error instanceof Error && /context|token|too long/i.test(error.message))) {
        throw new ReactionError('context_overflow', 502, 'Laya 输入超出模型上下文，请缩减候选词库。');
      }
      if (status === 429) throw new ReactionError('busy', 429, 'Laya 服务繁忙，请稍后再试。');
      throw new ReactionError('decision_unavailable', 502, '本地 Laya 暂时不可用，可以继续聆听。');
    } finally { clearTimeout(timer); }
  };
}
