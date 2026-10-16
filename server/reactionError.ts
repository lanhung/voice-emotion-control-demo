import type { ReactionErrorCode } from '../shared/reaction';

export class ReactionError extends Error {
  constructor(readonly code: ReactionErrorCode, readonly statusCode: number, message: string) { super(message); }
}
