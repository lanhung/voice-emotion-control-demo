export const reactionPolicy = {
  emotionWindow: 3, confirmations: 2, candidateTtlMs: 15_000,
  globalIntervalMs: 10_000, emotionIntervalMs: 30_000, usageWindowMs: 300_000,
  modelMix: 0.2, failureBackoffMs: 5000, acknowledgementMs: 5000,
  displayMs: 2500, animationGapMs: 5000, maxConcurrentModels: 2,
  maxClients: 512, maxTurnsPerClient: 512, turnTtlMs: 300_000,
} as const;

export interface ReactionClock { now: () => number; wallNow: () => number }
export const systemClock: ReactionClock = { now: () => performance.now(), wallNow: () => Date.now() };
