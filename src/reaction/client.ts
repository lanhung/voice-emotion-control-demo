import { reactionResponseSchema, displayedResponseSchema, REACTION_TIMEOUT_MS,
  type ReactionErrorCode, type ReactionRequest, type ReactionResponse, type DisplayedRequest, type DisplayedResponse } from '../../shared/reaction';

export const reactionErrorMessages: Record<ReactionErrorCode, string> = {
  catalog_missing: '短回应词库文件缺失，请检查服务端配置。', catalog_invalid: '短回应词库格式错误，请运行词库校验。',
  invalid_configuration: '请检查本地 Ollama 和 Laya 配置。', model_not_found: '未找到配置的 Laya 模型。',
  decision_timeout: 'Laya 候选评分超时，可以继续聆听。', decision_unavailable: '本地 Laya 暂时不可用，可以继续聆听。',
  busy: '短回应正在处理，请等待新的语音片段。', invalid_model_output: 'Laya 候选评分无效，已跳过本次回应。',
  invalid_request: '情绪决策请求无效，可以继续聆听。', context_overflow: '候选词库超过模型上下文，请检查服务端配置。',
};
export async function requestReaction(input: ReactionRequest, signal: AbortSignal): Promise<ReactionResponse> {
  const response = await fetch('/api/reaction/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(REACTION_TIMEOUT_MS)]) });
  const result = reactionResponseSchema.parse(await response.json());
  if (result.clientId !== input.clientId || result.sessionId !== input.sessionId || result.generation !== input.generation
    || result.turnId !== input.turnId || result.sequence !== input.sequence || (result.status !== 'error' && !response.ok)
    || (result.status === 'replied' && (result.decisionId !== input.turnId || result.emotion !== input.emotion))) throw new Error('Invalid reaction response');
  return result;
}
export async function acknowledgeReaction(input: DisplayedRequest, signal: AbortSignal): Promise<DisplayedResponse> {
  const response = await fetch('/api/reaction/displayed', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
  const result = displayedResponseSchema.parse(await response.json());
  if (result.decisionId !== input.decisionId || (!response.ok && result.status !== 'rejected')) throw new Error('Invalid display acknowledgement');
  return result;
}
