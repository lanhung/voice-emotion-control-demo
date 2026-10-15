import type { Emotion } from './emotions';

export const reactionPhrases = [
  'Congrats!', 'Well done!', 'Have fun!', 'Good luck!', "I'm here.", 'I understand.',
  "That's rough.", 'How lovely!', 'Awesome!', 'Anytime!', 'Got it.',
] as const;
export type ReactionPhrase = typeof reactionPhrases[number];
export const MAX_REACTION_TEXT_LENGTH = 4000;
export const REACTION_TIMEOUT_MS = 10_000;
export const REACTION_DISPLAY_MS = 2500;
export const REACTION_ANIMATION_GAP_MS = 5000;
export const REACTION_COALESCE_MS = 350;
export const REACTION_MIN_INTERVAL_MS = 4000;
export const MAX_REACTION_OUTPUT_LENGTH = 512;

export function isReactionPhrase(value: unknown): value is ReactionPhrase {
  return typeof value === 'string' && (reactionPhrases as readonly string[]).includes(value)
    && /^[A-Za-z]+(?:'[A-Za-z]+)?(?: [A-Za-z]+(?:'[A-Za-z]+)?)?[!.]?$/.test(value);
}

export interface ReactionRequest {
  sessionId: string;
  turnId: string;
  text: string;
  emotion: Emotion;
}
export type ReactionSkipReason = 'empty' | 'none' | 'invalid_output' | 'incomplete_output' | 'duplicate';
export type ReactionErrorCode = 'not_configured' | 'auth_failed' | 'rate_limited' | 'timeout'
  | 'unavailable' | 'busy' | 'cancelled' | 'invalid_request';
export interface ReactionOutput {
  modelOutput?: string;
  outputTruncated?: boolean;
  finishReason?: string | null;
}
interface ReactionTrace { sessionId: string; turnId: string; latencyMs: number; requestId: string }
export type ReactionResponse = ReactionTrace & ReactionOutput & (
  | { status: 'replied'; text: ReactionPhrase }
  | { status: 'skipped'; reason: ReactionSkipReason }
  | { status: 'error'; code: ReactionErrorCode; error: string }
);
