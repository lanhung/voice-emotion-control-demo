import type { Emotion } from '../shared/emotions';
import type { ReactionRequest, ReactionSkipReason } from '../shared/reaction';
import { reactionPolicy as policy } from './reactionPolicy';

export interface ReactionContext {
  generation: number; sessionId: string; sequence: number; emotions: Emotion[];
  lastSpeechAt: number; canDisplay: boolean;
}
export function createReactionContext(input: ReactionRequest): ReactionContext {
  return { generation: input.generation, sessionId: input.sessionId, sequence: -1,
    emotions: [], lastSpeechAt: -Infinity, canDisplay: input.canDisplay };
}
export function updateReactionContext(context: ReactionContext, input: ReactionRequest, now: number): ReactionSkipReason | null {
  if (input.generation < context.generation || (input.generation === context.generation && input.sessionId !== context.sessionId)) return 'stale_generation';
  if (input.generation > context.generation) Object.assign(context, createReactionContext(input));
  if (input.sequence <= context.sequence) return 'stale_sequence';
  context.sequence = input.sequence; context.canDisplay = input.canDisplay;
  if (!input.isSpeech) return 'non_speech';
  if (now - context.lastSpeechAt > policy.candidateTtlMs) context.emotions = [];
  context.emotions.push(input.emotion);
  context.emotions = context.emotions.slice(-policy.emotionWindow);
  context.lastSpeechAt = now;
  if (input.emotion === 'unknown') return 'unknown_emotion';
  return context.emotions.filter((emotion) => emotion === input.emotion).length >= policy.confirmations ? null : 'unstable_emotion';
}
