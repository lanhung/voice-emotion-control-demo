import { readFileSync } from 'node:fs';
import type { ReactionRequest } from '../shared/reaction';
import { parseReactionCatalog } from '../server/reactionCatalog';
import type { LayaInput, LayaScores } from '../server/laya';

export const header = 'id,text,emotions,weight,cooldown_seconds,enabled';
export const defaultCatalog = parseReactionCatalog(readFileSync('config/reaction-phrases.csv', 'utf8'));
export const request = (patch: Partial<ReactionRequest> = {}): ReactionRequest => ({
  clientId: 'client', sessionId: 'session', generation: 0, sequence: 1, turnId: 'turn-1',
  emotion: 'sad', isSpeech: true, canDisplay: true, ...patch,
});
export const scores = ({ candidates }: LayaInput): LayaScores => ({
  choice: candidates[0].id, probabilities: Object.fromEntries(candidates.map((phrase) => [phrase.id, 1 / candidates.length])),
  confidence: 0.2, usage: { input_tokens: 100, output_tokens: 1 },
});
