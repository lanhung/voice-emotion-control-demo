import { z } from 'zod';
import { catalogEmotionSchema, isReactionPhrase } from './reactionCatalog';

export { isReactionPhrase } from './reactionCatalog';
export type ReactionPhrase = string;
export const REACTION_TIMEOUT_MS = 12_000;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const reactionIdentitySchema = z.object({ clientId: identifier, sessionId: identifier, generation: counter });
export const reactionRequestSchema = reactionIdentitySchema.extend({
  turnId: identifier, sequence: counter, emotion: z.enum([...catalogEmotionSchema.options, 'unknown']), isSpeech: z.boolean(), canDisplay: z.boolean(),
}).strict();
export const displayedRequestSchema = reactionIdentitySchema.extend({ decisionId: identifier }).strict();
export const reactionSkipReasons = [
  'non_speech', 'unknown_emotion', 'unstable_emotion', 'no_candidate', 'all_on_cooldown',
  'global_interval', 'emotion_interval', 'display_unavailable', 'awaiting_display',
  'stale_generation', 'stale_sequence', 'superseded', 'expired', 'cancelled', 'failure_backoff',
] as const;
export const reactionErrorCodes = [
  'catalog_missing', 'catalog_invalid', 'decision_timeout', 'model_not_found', 'decision_unavailable',
  'busy', 'invalid_model_output', 'invalid_request', 'invalid_configuration', 'context_overflow',
] as const;
const trace = reactionIdentitySchema.extend({ turnId: identifier, sequence: counter,
  requestId: z.string(), latencyMs: z.number().nonnegative() });
export const reactionResponseSchema = z.discriminatedUnion('status', [
  trace.extend({ status: z.literal('replied'), decisionId: identifier, phraseId: identifier,
    text: z.string().refine(isReactionPhrase), emotion: catalogEmotionSchema,
    expiresAt: z.number().finite(), displayMs: z.number().int().positive().max(60_000),
    animationGapMs: z.number().int().nonnegative().max(60_000) }),
  trace.extend({ status: z.literal('skipped'), reason: z.enum(reactionSkipReasons) }),
  trace.extend({ status: z.literal('error'), code: z.enum(reactionErrorCodes), error: z.string() }),
]);
export const displayedResponseSchema = z.object({
  status: z.enum(['accepted', 'duplicate', 'rejected']), decisionId: identifier,
});
export type ReactionRequest = z.infer<typeof reactionRequestSchema>;
export type ReactionIdentity = z.infer<typeof reactionIdentitySchema>;
export type ReactionResponse = z.infer<typeof reactionResponseSchema>;
export type ReactionReply = Extract<ReactionResponse, { status: 'replied' }>;
export type ReactionSkipReason = typeof reactionSkipReasons[number];
export type ReactionErrorCode = typeof reactionErrorCodes[number];
export type DisplayedRequest = z.infer<typeof displayedRequestSchema>;
export type DisplayedResponse = z.infer<typeof displayedResponseSchema>;
