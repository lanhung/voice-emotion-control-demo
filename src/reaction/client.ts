import { isReactionPhrase, type ReactionErrorCode, type ReactionRequest, type ReactionResponse } from '../../shared/reaction';

export const reactionErrorMessages: Record<ReactionErrorCode, string> = {
  not_configured: '短回应尚未配置，请检查服务端模型设置。',
  auth_failed: '短回应认证失败，请检查服务端密钥。',
  rate_limited: '短回应服务繁忙，请稍后再试。', busy: '短回应正在处理，请稍后再试。',
  timeout: '短回应等待超时，可以继续聆听。', unavailable: '短回应暂时不可用，可以继续聆听。',
  cancelled: '这次短回应已取消。', invalid_request: '这段文字无法用于短回应，可以继续聆听。',
};

export async function requestReaction(input: ReactionRequest, signal: AbortSignal): Promise<ReactionResponse> {
  const response = await fetch('/api/reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]) });
  const result = await response.json() as Partial<ReactionResponse> | null;
  if (!result || result.turnId !== input.turnId || result.sessionId !== input.sessionId
    || !['replied', 'skipped', 'error'].includes(result.status ?? '')
    || (result.status !== 'error' && !response.ok)
    || (result.status === 'replied' && !isReactionPhrase(result.text))) throw new Error('Invalid reaction response');
  return result as ReactionResponse;
}
