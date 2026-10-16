import type { ReactionRequest, ReactionResponse, ReactionReply, ReactionSkipReason, DisplayedRequest } from '../shared/reaction';
import { CatalogError, loadReactionCatalog, type ReactionCatalog } from './reactionCatalog';
import { createLayaScorer, readLayaConfig, type LayaConfig, type ScoreCandidates } from './laya';
import { ReactionError } from './reactionError';
import { updateReactionContext } from './reactionContext';
import { drawCandidate, weightCandidates } from './reactionDecision';
import { ReactionUsage, type ClientRecord, type ReactionLog, type RememberedTurn } from './reactionUsage';
import { reactionPolicy as policy, systemClock, type ReactionClock } from './reactionPolicy';

export interface ReactionServiceOptions {
  catalog?: ReactionCatalog | CatalogError; catalogPath?: string; layaConfig?: LayaConfig | null;
  score?: ScoreCandidates; clock?: ReactionClock; random?: () => number; log?: ReactionLog; maxClients?: number;
}
export async function createReactionService(options: ReactionServiceOptions = {}) {
  let catalog = options.catalog;
  if (!catalog) {
    try { catalog = await loadReactionCatalog(options.catalogPath); }
    catch (error) { catalog = error instanceof CatalogError ? error : new CatalogError('catalog_invalid', 'Cannot load reaction catalog'); }
  }
  return new ReactionService(catalog, options);
}

export class ReactionService {
  private readonly clock: ReactionClock;
  private readonly random: () => number;
  private readonly log: ReactionLog;
  private readonly score: ScoreCandidates;
  private readonly usage: ReactionUsage;
  private readonly model: string | undefined;
  private activeModels = 0;
  constructor(private readonly catalog: ReactionCatalog | CatalogError, options: ReactionServiceOptions = {}) {
    this.clock = options.clock ?? systemClock; this.random = options.random ?? Math.random;
    this.log = options.log ?? (() => undefined);
    const config = options.layaConfig === undefined ? readLayaConfig() : options.layaConfig;
    this.model = config?.model; this.score = options.score ?? createLayaScorer(config);
    this.usage = new ReactionUsage(catalog instanceof CatalogError ? 0 : catalog.maxCooldownMs, this.log, options.maxClients);
    if (catalog instanceof CatalogError) this.log('reaction.failed', { code: catalog.code, error: catalog.message });
    else this.log('reaction.catalog_loaded', { version: catalog.version, phrases: catalog.phrases.length });
  }
  close() { this.usage.close(); }
  sweep() { this.usage.sweep(this.clock.now()); }
  displayed(input: DisplayedRequest) { return this.usage.displayed(input, this.clock.now()); }

  async decide(input: ReactionRequest, signal: AbortSignal, requestId: string): Promise<ReactionResponse> {
    const started = this.clock.now();
    const trace = { clientId: input.clientId, sessionId: input.sessionId, generation: input.generation,
      turnId: input.turnId, sequence: input.sequence, requestId };
    const skip = (reason: ReactionSkipReason): ReactionResponse => ({ ...trace, latencyMs: Math.max(0, Math.round(this.clock.now() - started)), status: 'skipped', reason });
    const failure = (error: ReactionError): ReactionResponse => ({ ...trace, latencyMs: Math.max(0, Math.round(this.clock.now() - started)),
      status: 'error', code: error.code, error: error.message });
    const busy = () => failure(new ReactionError('busy', 429, '短回应正在处理，请等待新的语音片段。'));
    if (signal.aborted) return skip('cancelled');
    const client = this.usage.get(input, started);
    if (!client) return busy();
    if (input.generation < client.context.generation || (input.generation === client.context.generation && input.sessionId !== client.context.sessionId)) return skip('stale_generation');
    const remembered = client.turns.get(input.turnId);
    if (remembered) {
      if (JSON.stringify(remembered.input) !== JSON.stringify(input)) return failure(new ReactionError('invalid_request', 400, '同一 turnId 不能用于不同片段。'));
      const result = await remembered.promise;
      if (input.generation !== client.context.generation) return skip('stale_generation');
      if (result.status === 'replied') {
        const delivery = client.deliveries.get(result.decisionId);
        if (!delivery || this.clock.now() >= delivery.deadline) return skip('expired');
        if (delivery.status !== 'pending') return skip('superseded');
      }
      return result;
    }
    const newerGeneration = input.generation > client.context.generation;
    const contextReason = updateReactionContext(client.context, input, started);
    if (contextReason === 'stale_sequence' || contextReason === 'stale_generation') return skip(contextReason);
    if (newerGeneration || (input.isSpeech && client.active?.emotion !== input.emotion)) client.active?.controller.abort();
    if (newerGeneration || (input.isSpeech && client.pending?.reply.emotion !== input.emotion)) this.usage.invalidatePending(client);
    if (client.turns.size >= policy.maxTurnsPerClient) return busy();
    let resolve!: (result: ReactionResponse) => void;
    const entry: RememberedTurn = { input, createdAt: started, promise: new Promise((done) => { resolve = done; }) };
    client.turns.set(input.turnId, entry); // Publish the shared promise before any asynchronous scoring.
    const finish = (result: ReactionResponse) => {
      entry.result = result; resolve(result);
      this.log(result.status === 'error' ? 'reaction.failed' : result.status === 'skipped' ? 'reaction.skipped' : 'reaction.decided', {
        ...result, ...(this.catalog instanceof CatalogError ? {} : { catalogVersion: this.catalog.version }),
      });
      return result;
    };
    try {
      if (this.catalog instanceof CatalogError) return finish(failure(new ReactionError(this.catalog.code, 503, this.catalog.message)));
      if (contextReason) return finish(skip(contextReason));
      // updateReactionContext already excludes unknown; narrow at the application boundary.
      if (input.emotion === 'unknown') return finish(skip('unknown_emotion'));
      const emotion = input.emotion;
      const interval = this.usage.intervalReason(client, input.emotion, started);
      if (interval) return finish(skip(interval));
      if (started < client.failureUntil) return finish(skip('failure_backoff'));
      const mapped = this.catalog.phrases.filter((phrase) => phrase.enabled && phrase.emotions.includes(emotion));
      if (!mapped.length) return finish(skip('no_candidate'));
      let candidates = mapped.filter((phrase) => !this.usage.isCooling(client, phrase, started));
      if (!candidates.length) return finish(skip('all_on_cooldown'));
      if (candidates.length >= 2) candidates = candidates.filter((phrase) => phrase.id !== client.lastPhraseId);
      // Never release a cancelled slot until its transport actually settles.
      if (client.active || (candidates.length >= 2 && this.activeModels >= policy.maxConcurrentModels)) return finish(busy());
      const controller = new AbortController();
      const combined = AbortSignal.any([signal, controller.signal]);
      const active = { controller, generation: input.generation, sessionId: input.sessionId, emotion: input.emotion };
      client.active = active;
      let chosen = candidates[0];
      try {
        if (candidates.length >= 2) {
          this.activeModels++;
          try {
            this.log('reaction.model_requested', { ...trace, model: this.model, candidates: candidates.map((phrase) => phrase.id), catalogVersion: this.catalog.version });
            const scores = await this.score({ emotion: input.emotion, recentEmotions: [...client.context.emotions], candidates }, combined);
            const rows = weightCandidates(candidates, (id) => this.usage.recentCount(client, id, this.clock.now()), scores);
            chosen = drawCandidate(rows, this.random);
            this.log('reaction.model_scored', { ...trace, model: this.model, ...scores,
              weights: rows.map((row) => ({ phraseId: row.phrase.id, baseWeight: row.phrase.weight, recentCount: row.recentCount,
                adjustedWeight: row.adjustedWeight, finalWeight: row.finalWeight, probability: row.probability })) });
          } finally { this.activeModels--; }
        }
        const now = this.clock.now();
        const stale = this.staleReason(client, input, combined, started, now);
        if (stale) return finish(skip(stale));
        const intervalNow = this.usage.intervalReason(client, input.emotion, now);
        if (intervalNow) return finish(skip(intervalNow));
        if (this.usage.isCooling(client, chosen, now)) return finish(skip('all_on_cooldown'));
        const deadline = Math.min(started + policy.candidateTtlMs, now + policy.acknowledgementMs);
        const reply: ReactionReply = { ...trace, latencyMs: Math.max(0, Math.round(now - started)), status: 'replied',
          decisionId: input.turnId, phraseId: chosen.id, text: chosen.text, emotion: input.emotion,
          expiresAt: this.clock.wallNow() + deadline - now, displayMs: policy.displayMs, animationGapMs: policy.animationGapMs };
        // Synchronous reservation and result publication form one commit, with no intervening await.
        this.usage.reserve(client, chosen, reply, now, deadline);
        this.log('reaction.selection', { ...trace, source: candidates.length === 1 ? 'single_candidate' : 'laya',
          phraseId: chosen.id, baseWeight: chosen.weight, recentCount: this.usage.recentCount(client, chosen.id, now) });
        return finish(reply);
      } catch (error) {
        const stale = this.staleReason(client, input, combined, started, this.clock.now());
        if (stale) return finish(skip(stale));
        client.failureUntil = this.clock.now() + policy.failureBackoffMs;
        throw error;
      } finally { if (client.active === active) client.active = undefined; }
    } catch (error) {
      return finish(failure(error instanceof ReactionError ? error : new ReactionError('decision_unavailable', 502, '本地决策暂时不可用，可以继续聆听。')));
    }
  }
  private staleReason(client: ClientRecord, input: ReactionRequest, signal: AbortSignal, started: number, now: number): ReactionSkipReason | null {
    if (input.generation !== client.context.generation || input.sessionId !== client.context.sessionId) return 'stale_generation';
    if (client.context.emotions.at(-1) !== input.emotion) return 'superseded';
    if (signal.aborted) return 'cancelled';
    if (now - started >= policy.candidateTtlMs) return 'expired';
    return null;
  }
}
