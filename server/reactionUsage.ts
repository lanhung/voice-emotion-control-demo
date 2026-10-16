import type { ReactionRequest, ReactionResponse, ReactionReply, DisplayedRequest, DisplayedResponse, ReactionSkipReason } from '../shared/reaction';
import type { CatalogEmotion, CatalogPhrase } from '../shared/reactionCatalog';
import { createReactionContext, type ReactionContext } from './reactionContext';
import { reactionPolicy as policy } from './reactionPolicy';

export type ReactionLog = (event: string, fields: Record<string, unknown>) => void;
interface PhraseUsage { lastConfirmedAt: number; recent: number[]; count: number; reservedUntil: number }
export interface Delivery {
  reply: ReactionReply; phrase: CatalogPhrase; deadline: number; createdAt: number;
  status: 'pending' | 'confirmed' | 'unconfirmed';
}
export interface RememberedTurn {
  input: ReactionRequest; createdAt: number; promise: Promise<ReactionResponse>; result?: ReactionResponse;
}
export interface ClientRecord {
  context: ReactionContext; lastTouchedAt: number; phrases: Map<string, PhraseUsage>;
  lastPhraseId?: string; globalUntil: number; emotionUntil: Map<CatalogEmotion, number>;
  pending?: Delivery; deliveries: Map<string, Delivery>; turns: Map<string, RememberedTurn>;
  active?: { controller: AbortController; generation: number; sessionId: string; emotion: CatalogEmotion };
  failureUntil: number;
}

/** Monotonic timestamps only. A delivery reserves cooldowns before any acknowledgement. */
export class ReactionUsage {
  private readonly clients = new Map<string, ClientRecord>();
  readonly ttlMs: number;
  constructor(maxCooldownMs: number, private readonly log: ReactionLog, private readonly maxClients: number = policy.maxClients) {
    this.ttlMs = Math.max(policy.usageWindowMs, maxCooldownMs, policy.emotionIntervalMs) + policy.acknowledgementMs;
  }
  private phrase(client: ClientRecord, id: string): PhraseUsage {
    let usage = client.phrases.get(id);
    if (!usage) {
      usage = { lastConfirmedAt: -Infinity, recent: [], count: 0, reservedUntil: -Infinity };
      client.phrases.set(id, usage);
    }
    return usage;
  }
  get(input: ReactionRequest, now: number): ClientRecord | null {
    this.sweep(now);
    let client = this.clients.get(input.clientId);
    if (!client) {
      if (this.clients.size >= this.maxClients) return null;
      client = { context: createReactionContext(input), lastTouchedAt: now, phrases: new Map(),
        globalUntil: -Infinity, emotionUntil: new Map(), deliveries: new Map(), turns: new Map(), failureUntil: -Infinity };
      this.clients.set(input.clientId, client);
    }
    client.lastTouchedAt = now;
    return client;
  }
  sweep(now: number) {
    for (const [id, client] of this.clients) {
      if (client.pending && now >= client.pending.deadline) this.invalidatePending(client);
      for (const usage of client.phrases.values()) usage.recent = usage.recent.filter((at) => at > now - policy.usageWindowMs);
      for (const [key, turn] of client.turns) if (turn.result && now - turn.createdAt >= policy.turnTtlMs) client.turns.delete(key);
      for (const [key, delivery] of client.deliveries) {
        if (delivery.status !== 'pending' && now - delivery.createdAt >= this.ttlMs) client.deliveries.delete(key);
      }
      if (!client.active && !client.pending && now - client.lastTouchedAt >= this.ttlMs) this.clients.delete(id);
    }
  }
  invalidatePending(client: ClientRecord) {
    const delivery = client.pending;
    if (!delivery) return;
    delivery.status = 'unconfirmed'; client.pending = undefined;
    this.log('reaction.delivery_unconfirmed', { clientId: delivery.reply.clientId, decisionId: delivery.reply.decisionId,
      phraseId: delivery.phrase.id, generation: delivery.reply.generation });
  }
  intervalReason(client: ClientRecord, emotion: CatalogEmotion, now: number): ReactionSkipReason | null {
    if (client.pending) return 'awaiting_display';
    if (!client.context.canDisplay) return 'display_unavailable';
    if (now < client.globalUntil) return 'global_interval';
    if (now < (client.emotionUntil.get(emotion) ?? -Infinity)) return 'emotion_interval';
    return null;
  }
  isCooling(client: ClientRecord, phrase: CatalogPhrase, now: number): boolean {
    const usage = client.phrases.get(phrase.id);
    return !!usage && (now < usage.reservedUntil || now - usage.lastConfirmedAt < phrase.cooldown_seconds * 1000);
  }
  recentCount(client: ClientRecord, id: string, now: number): number {
    return client.phrases.get(id)?.recent.filter((at) => at > now - policy.usageWindowMs).length ?? 0;
  }
  reserve(client: ClientRecord, phrase: CatalogPhrase, reply: ReactionReply, now: number, deadline: number) {
    const delivery: Delivery = { phrase, reply, createdAt: now, deadline, status: 'pending' };
    client.pending = delivery; client.deliveries.set(reply.decisionId, delivery);
    client.globalUntil = Math.max(client.globalUntil, now + policy.globalIntervalMs);
    client.emotionUntil.set(reply.emotion, Math.max(client.emotionUntil.get(reply.emotion) ?? -Infinity, now + policy.emotionIntervalMs));
    this.phrase(client, phrase.id).reservedUntil = Math.max(deadline, now + phrase.cooldown_seconds * 1000);
    client.lastTouchedAt = now;
  }
  displayed(input: DisplayedRequest, now: number): DisplayedResponse {
    this.sweep(now);
    const client = this.clients.get(input.clientId);
    const delivery = client?.deliveries.get(input.decisionId);
    const result = (status: DisplayedResponse['status']): DisplayedResponse => ({ status, decisionId: input.decisionId });
    if (!client || !delivery || delivery.reply.sessionId !== input.sessionId || delivery.reply.generation !== input.generation) return result('rejected');
    if (delivery.status === 'confirmed') return result('duplicate');
    if (delivery.status !== 'pending' || now >= delivery.deadline || client.context.generation !== input.generation
      || client.context.sessionId !== input.sessionId) return result('rejected');
    delivery.status = 'confirmed'; client.pending = undefined;
    const usage = this.phrase(client, delivery.phrase.id);
    usage.lastConfirmedAt = now; usage.recent.push(now); usage.count++;
    client.lastPhraseId = delivery.phrase.id;
    client.globalUntil = Math.max(client.globalUntil, now + policy.globalIntervalMs);
    client.emotionUntil.set(delivery.reply.emotion, now + policy.emotionIntervalMs);
    client.lastTouchedAt = now;
    this.log('reaction.displayed', { ...input, phraseId: delivery.phrase.id, count: usage.count, recentCount: usage.recent.length });
    return result('accepted');
  }
  close() { for (const client of this.clients.values()) client.active?.controller.abort(); }
}
