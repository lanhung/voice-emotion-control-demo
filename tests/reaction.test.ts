import { describe, expect, it, vi } from 'vitest';
import { reactionRequestSchema, displayedRequestSchema } from '../shared/reaction';
import { isReactionPhrase } from '../shared/reactionCatalog';
import { loadReactionCatalog, parseReactionCatalog } from '../server/reactionCatalog';
import { readLayaConfig } from '../server/laya';
import { ReactionService } from '../server/reaction';
import { ReactionError } from '../server/reactionError';
import { drawCandidate, weightCandidates } from '../server/reactionDecision';
import type { ReactionRequest, ReactionResponse } from '../shared/reaction';
import type { ReactionServiceOptions } from '../server/reaction';
import { defaultCatalog, header, request, scores } from './reaction-fixtures';

function harness(options: ReactionServiceOptions = {}) {
  let now = 0; let sequence = 0;
  const log = vi.fn(); const score = vi.fn(async (input) => scores(input));
  const service = new ReactionService(options.catalog ?? defaultCatalog, {
    clock: { now: () => now, wallNow: () => 1_700_000_000_000 + now }, random: () => 0, score, log, ...options,
  });
  const send = (patch: Partial<ReactionRequest> = {}, signal = new AbortController().signal) => {
    sequence++;
    return service.decide(request({ turnId: `turn-${sequence}`, sequence, ...patch }), signal, `request-${sequence}`);
  };
  const ack = (reply: ReactionResponse) => {
    if (reply.status !== 'replied') throw new Error(`Expected reply, received ${JSON.stringify(reply)}`);
    return service.displayed({ clientId: reply.clientId, sessionId: reply.sessionId, generation: reply.generation, decisionId: reply.decisionId });
  };
  return { service, score, log, send, ack, advance: (ms: number) => { now += ms; service.sweep(); } };
}

describe('catalog and protocol validation', () => {
  it('loads the sole phrase source, normalizes apostrophes and supports BOM, CRLF, quoted cells and blank lines', () => {
    const csv = `\uFEFF${header}\r\n\r\n"one"," I’m here. ",sad|fearful,3,60,true\r\n\r\n`;
    expect(parseReactionCatalog(csv).phrases[0]).toMatchObject({ text: "I'm here.", emotions: ['sad', 'fearful'], weight: 3 });
    expect(defaultCatalog.phrases.some((phrase) => phrase.enabled)).toBe(true);
    expect(parseReactionCatalog(header).phrases).toEqual([]);
    expect(parseReactionCatalog(`${header}\nx,Hello!,neutral,1,0,false`).phrases[0].enabled).toBe(false);
    expect(isReactionPhrase('Stay close.')).toBe(true); // New valid words need no whitelist.
  });
  it.each([
    ['x,Hi!,unknown,1,1,true', 'emotions'], ['x,Hi!,sad|sad,1,1,true', 'emotions'],
    ['x,Hi!,sad,NaN,1,true', 'weight'], ['x,Hi!,sad,Infinity,1,true', 'weight'], ['x,Hi!,sad,0,1,true', 'weight'],
    ['x,Hi!,sad,1,-1,true', 'cooldown_seconds'], ['x,Hi!,sad,1,1.5,true', 'cooldown_seconds'],
    ['x,Hi!,sad,1,1,yes', 'enabled'], ['x,Hello there friend,sad,1,1,false', 'text'],
    ['x,"Hi, you!",sad,1,1,true', 'text'], ['x,"Hi ""you""",sad,1,1,true', 'text'],
    ['x,Supercalifragilistic!,sad,1,1,true', 'text'], ['x,Héllo!,sad,1,1,true', 'text'],
    ['x,Hi!,sad,1,1,true,extra', 'csv'],
  ])('reports the file, physical line and field for %s', (row, field) => {
    expect(() => parseReactionCatalog(`${header}\n\n${row}`, 'catalog.csv')).toThrow(`catalog.csv:3 [${field}`);
  });
  it('rejects malformed headers, duplicate IDs and normalized duplicates, including disabled rows', () => {
    expect(() => parseReactionCatalog('id,id')).toThrow('duplicate column');
    expect(() => parseReactionCatalog('id,text')).toThrow('missing column');
    expect(() => parseReactionCatalog(`${header},extra`)).toThrow('unknown column');
    expect(() => parseReactionCatalog('')).toThrow('missing header');
    expect(() => parseReactionCatalog(`${header}\nx,Hi!,sad,1,1,true\nx,Hello!,sad,1,1,true`)).toThrow('duplicate ID');
    expect(() => parseReactionCatalog(`${header}\nx,Hi!,sad,1,1,true\ny,hi.,sad,1,1,false`)).toThrow('duplicate normalized phrase');
    expect(() => parseReactionCatalog(`${header}\nx,"Hi!,sad,1,1,true`)).toThrow('[csv]');
  });
  it('limits each enabled emotion pool to twenty phrases', () => {
    const rows = Array.from({ length: 21 }, (_, i) => `id${i},Hello ${String.fromCharCode(65 + i)}!,happy,1,1,true`);
    expect(() => parseReactionCatalog(`${header}\n${rows.join('\n')}`)).toThrow('exceeds 20');
  });
  it('has stable normalized versions and a distinct missing-file failure', async () => {
    const row = 'x,Hi!,sad|fearful,1,1,true';
    expect(parseReactionCatalog(`${header}\n${row}`).version).toBe(parseReactionCatalog(`\uFEFF${header}\r\n${row.replace('sad|fearful', 'fearful|sad')}\r\n`).version);
    await expect(loadReactionCatalog('/nonexistent/aura.csv')).rejects.toMatchObject({ code: 'catalog_missing' });
  });
  it('rejects transcript, candidate, time and configuration injection', () => {
    expect(reactionRequestSchema.safeParse(request()).success).toBe(true);
    for (const patch of [{ text: 'private transcript' }, { candidates: [] }, { generation: -1 }, { sequence: 1.5 }, { emotion: 'HAPPY' }, { model: 'x' }]) {
      expect(reactionRequestSchema.safeParse({ ...request(), ...patch }).success).toBe(false);
    }
    expect(displayedRequestSchema.safeParse({ clientId: 'c', sessionId: 's', generation: 1, decisionId: 'd', count: 5 }).success).toBe(false);
    expect(readLayaConfig({})).toMatchObject({ model: 'laya:322m-multilingual-mlx-fp16', timeoutMs: 5000 });
    for (const patch of [{ OLLAMA_BASE_URL: 'file:///tmp/a' }, { OLLAMA_BASE_URL: 'http://localhost:11434/v1' }, { LAYA_TIMEOUT_MS: '999' }, { LAYA_TIMEOUT_MS: '10001' }]) expect(readLayaConfig(patch)).toBeNull();
  });
});

describe('server emotion context, selection and delivery accounting', () => {
  it('requires the latest label twice within three speech segments and skips unknown/non-speech', async () => {
    const h = harness();
    expect(await h.send()).toMatchObject({ reason: 'unstable_emotion' });
    expect(await h.send({ isSpeech: false })).toMatchObject({ reason: 'non_speech' });
    expect(await h.send({ emotion: 'unknown' })).toMatchObject({ reason: 'unknown_emotion' });
    expect(await h.send()).toMatchObject({ status: 'replied' });
    expect(h.score).toHaveBeenCalledTimes(1);
    expect(h.score.mock.calls[0][0].recentEmotions).toEqual(['sad', 'unknown', 'sad']);
    expect(JSON.stringify(h.score.mock.calls[0][0])).not.toContain('transcript');
  });
  it('does not reuse old labels after silence, out-of-order fragments or generations', async () => {
    const h = harness(); await h.send(); h.advance(15_001);
    expect(await h.send()).toMatchObject({ reason: 'unstable_emotion' });
    expect(await h.send({ sequence: 1 })).toMatchObject({ reason: 'stale_sequence' });
    expect(await h.send({ generation: 1, sessionId: 'new' })).toMatchObject({ reason: 'unstable_emotion' });
    expect(await h.send()).toMatchObject({ reason: 'stale_generation' });
    expect(await h.send({ generation: 1, sessionId: 'wrong' })).toMatchObject({ reason: 'stale_generation' });
  });
  it('deduplicates scoring and deliveries and commits only the first valid acknowledgement', async () => {
    const h = harness(); await h.send(); const reply = await h.send();
    expect(reply).toMatchObject({ status: 'replied', phraseId: 'support_here' });
    expect(await h.send({ turnId: 'turn-2', sequence: 2 })).toEqual(reply);
    expect(h.score).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls.filter(([event]) => event === 'reaction.displayed')).toHaveLength(0);
    expect(h.service.displayed({ clientId: 'client', sessionId: 'wrong', generation: 0, decisionId: 'turn-2' }).status).toBe('rejected');
    expect(h.ack(reply).status).toBe('accepted');
    h.advance(9000); expect(h.ack(reply).status).toBe('duplicate');
    expect(h.log.mock.calls.filter(([event]) => event === 'reaction.displayed')).toHaveLength(1);
    expect(await h.send()).toMatchObject({ reason: 'global_interval' });
    h.advance(1000); expect(await h.send()).toMatchObject({ reason: 'emotion_interval' });
    h.advance(20_000); await h.send(); const next = await h.send();
    expect(next).toMatchObject({ status: 'replied', phraseId: 'support_with_you' });
    expect(h.score.mock.calls.at(-1)![0].candidates.map((p: { id: string }) => p.id)).not.toContain('support_here');
  });
  it('reserves missing acknowledgements without adding usage, including across generation changes', async () => {
    const catalog = parseReactionCatalog(`${header}\nx,Here.,sad|fearful,1,60,true`);
    const h = harness({ catalog }); await h.send(); const reply = await h.send();
    expect(h.score).not.toHaveBeenCalled();
    expect(await h.send()).toMatchObject({ reason: 'awaiting_display' });
    h.advance(5000); expect(h.ack(reply).status).toBe('rejected');
    expect(h.log.mock.calls.filter(([event]) => event === 'reaction.delivery_unconfirmed')).toHaveLength(1);
    await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' });
    expect(await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' })).toMatchObject({ reason: 'global_interval' });
    h.advance(5000);
    expect(await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' })).toMatchObject({ reason: 'all_on_cooldown' });
    h.advance(50_000); await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' });
    expect(await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' })).toMatchObject({ status: 'replied' });
    expect(h.log.mock.calls.filter(([event]) => event === 'reaction.displayed')).toHaveLength(0);
    expect(h.log.mock.calls.some(([event, fields]) => event === 'reaction.selection' && fields.source === 'single_candidate')).toBe(true);
  });
  it('starts confirmed cooldown at receipt time and rejects acknowledgements exactly at the deadline', async () => {
    const h = harness(); await h.send(); const reply = await h.send();
    h.advance(4999); expect(h.ack(reply).status).toBe('accepted');
    h.advance(5001); expect(await h.send()).toMatchObject({ reason: 'global_interval' });
    h.advance(4999); expect(await h.send()).toMatchObject({ reason: 'emotion_interval' });
    const other = harness(); await other.send(); const late = await other.send(); other.advance(5000);
    expect(other.ack(late).status).toBe('rejected');
  });
  it('keeps confirmed shared-phrase cooldown across emotion and recording changes; isolates clients', async () => {
    const catalog = parseReactionCatalog(`${header}\nx,Here.,sad|fearful,1,60,true`);
    const h = harness({ catalog }); await h.send(); h.ack(await h.send()); h.advance(10_000);
    await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' });
    expect(await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' })).toMatchObject({ reason: 'all_on_cooldown' });
    await h.send({ clientId: 'other' }); expect(await h.send({ clientId: 'other' })).toMatchObject({ status: 'replied' });
    h.advance(50_000); await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' });
    expect(await h.send({ generation: 1, sessionId: 'new', emotion: 'fearful' })).toMatchObject({ status: 'replied' });
  });
  it('updates emotion while the UI is unavailable, without queuing a future reply', async () => {
    const h = harness(); await h.send({ canDisplay: false });
    expect(await h.send({ canDisplay: false })).toMatchObject({ reason: 'display_unavailable' });
    expect(h.score).not.toHaveBeenCalled(); h.advance(1000);
    expect(await h.send()).toMatchObject({ status: 'replied' });
  });
  it('has no enabled neutral pool and permits an entirely empty catalog', async () => {
    const h = harness(); await h.send({ emotion: 'neutral' });
    expect(await h.send({ emotion: 'neutral' })).toMatchObject({ reason: 'no_candidate' });
    const empty = harness({ catalog: parseReactionCatalog(header) }); await empty.send();
    expect(await empty.send()).toMatchObject({ reason: 'no_candidate' }); expect(empty.score).not.toHaveBeenCalled();
  });
  it('does not evict clients before the longest cooldown, and reclaims idle clients afterwards', async () => {
    const catalog = parseReactionCatalog(`${header}\nx,Here.,sad,1,600,true`);
    const h = harness({ catalog, maxClients: 1 }); await h.send(); h.ack(await h.send());
    h.advance(300_001); expect(await h.send({ clientId: 'other' })).toMatchObject({ code: 'busy' });
    h.advance(305_000); expect(await h.send({ clientId: 'other' })).toMatchObject({ reason: 'unstable_emotion' });
  });
  it('applies a failure backoff and never falls back to a random phrase or automatically retries', async () => {
    const score = vi.fn().mockRejectedValue(new ReactionError('decision_timeout', 504, 'timeout'));
    const h = harness({ score }); await h.send(); expect(await h.send()).toMatchObject({ code: 'decision_timeout' });
    h.advance(4999); expect(await h.send()).toMatchObject({ reason: 'failure_backoff' }); expect(score).toHaveBeenCalledTimes(1);
    h.advance(1); expect(score).toHaveBeenCalledTimes(1); await h.send(); expect(score).toHaveBeenCalledTimes(2);
  });
  it('deduplicates in-flight requests, cancels incompatible emotion and discards late model output', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const score = vi.fn(async (input, _signal) => { await gate; return scores(input); });
    const h = harness({ score }); await h.send();
    const first = h.send(); const duplicate = h.send({ turnId: 'turn-2', sequence: 2 });
    expect(score).toHaveBeenCalledTimes(1);
    expect(await h.send({ emotion: 'happy' })).toMatchObject({ reason: 'unstable_emotion' });
    expect(score.mock.calls[0][1].aborted).toBe(true);
    release(); expect(await first).toMatchObject({ reason: 'superseded' }); expect(await duplicate).toMatchObject({ reason: 'superseded' });
    expect(h.log.mock.calls.some(([event]) => event === 'reaction.displayed')).toBe(false);
  });
  it('enforces global concurrency and expires scores even if a scorer ignores cancellation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ score: async (input) => { await gate; return scores(input); } });
    await h.send(); const first = h.send();
    expect(await h.send()).toMatchObject({ code: 'busy' });
    await h.send({ clientId: 'second' }); const second = h.send({ clientId: 'second' });
    await h.send({ clientId: 'third' }); expect(await h.send({ clientId: 'third' })).toMatchObject({ code: 'busy' });
    h.advance(15_000); release();
    expect(await first).toMatchObject({ reason: 'expired' }); expect(await second).toMatchObject({ reason: 'expired' });
  });
});

describe('frequency adjustment and deterministic draws', () => {
  it('blends the model and recent usage into the specified 58/42 distribution', () => {
    const candidates = parseReactionCatalog(`${header}\na,Here.,sad,2,0,true\nb,With you.,sad,1,0,true`).phrases;
    const result = weightCandidates(candidates, (id) => id === 'a' ? 1 : 0,
      { choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.2, usage: { input_tokens: 100, output_tokens: 1 } });
    expect(result[0].probability).toBeCloseTo(0.58);
    expect(drawCandidate(result, () => 0).id).toBe('a'); expect(drawCandidate(result, () => 0.5799).id).toBe('a');
    expect(drawCandidate(result, () => 0.58).id).toBe('b'); expect(drawCandidate(result, () => 0.9999).id).toBe('b');
  });
  it('avoids numeric overflow and underflow with finite positive CSV weights', () => {
    for (const weight of [1e308, Number.MIN_VALUE]) {
      const candidates = parseReactionCatalog(`${header}\na,Here.,sad,${weight},0,true\nb,With you.,sad,${weight},0,true`).phrases;
      const result = weightCandidates(candidates, () => 5, scores({ candidates, emotion: 'sad', recentEmotions: [] }));
      expect(result.map((row) => row.probability)).toEqual([0.5, 0.5]);
    }
  });
  it('restores frequency weights when confirmed uses leave the 300-second window', async () => {
    const h = harness(); await h.send(); h.ack(await h.send()); h.advance(300_001);
    await h.send(); h.ack(await h.send()); h.advance(60_001); await h.send(); await h.send();
    const scored = h.log.mock.calls.filter(([event]) => event === 'reaction.model_scored').at(-1)![1];
    expect(scored.weights.find((row: { phraseId: string }) => row.phraseId === 'support_here').recentCount).toBe(0);
  });
});
