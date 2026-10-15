import type { AnalysisResult, Emotion } from '../../shared/emotions';
import { MAX_REACTION_TEXT_LENGTH, type ReactionRequest } from '../../shared/reaction';

// Keep complete recognition segments, including recent negations and corrections.
export const MAX_CONTEXT_SEGMENTS = 6;
type Segment = Pick<AnalysisResult, 'text' | 'emotion' | 'durationMs'>;
export interface ReactionContext { segments: Segment[] }
export const createReactionContext = (): ReactionContext => ({ segments: [] });

export function appendReactionContext(context: ReactionContext, result: AnalysisResult): 'accepted' | 'ignored' | 'too_long' {
  const text = result.text.trim();
  if (!result.isSpeech || !/[\p{L}\p{N}]/u.test(text)) return 'ignored';
  if (text.length > MAX_REACTION_TEXT_LENGTH) { context.segments = []; return 'too_long'; }
  context.segments.push({ text, emotion: result.emotion, durationMs: result.durationMs });
  while (context.segments.length > MAX_CONTEXT_SEGMENTS
    || context.segments.reduce((length, part) => length + part.text.length + 1, -1) > MAX_REACTION_TEXT_LENGTH) {
    context.segments.shift();
  }
  return 'accepted';
}

export function reactionContextRequest(context: ReactionContext, sessionId: string, turnId: string): ReactionRequest {
  let emotion: Emotion = 'unknown';
  const durations: Partial<Record<Emotion, number>> = {};
  for (const part of context.segments) {
    if (part.emotion === 'unknown') continue;
    const duration = (durations[part.emotion] ?? 0) + part.durationMs;
    durations[part.emotion] = duration;
    if (duration >= (durations[emotion] ?? 0)) emotion = part.emotion;
  }
  return { sessionId, turnId, text: context.segments.map((part) => part.text).join('\n'), emotion };
}
