import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult } from '../shared/emotions';
import type { ReactionRequest, ReactionResponse, ReactionReply, DisplayedRequest, DisplayedResponse } from '../shared/reaction';
import { ReactionStream, type ReactionState } from '../src/reaction/stream';
import { requestReaction } from '../src/reaction/client';

const speech = (emotion: AnalysisResult['emotion'] = 'sad'): AnalysisResult => ({
  text: 'This transcript stays in the browser.', emotion, isSpeech: true, language: 'en', events: [], tags: [],
  emotionTag: null, latencyMs: 10, durationMs: 2500,
});
function harness() {
  const calls: { input: ReactionRequest; signal: AbortSignal; resolve: (value: ReactionResponse) => void }[] = [];
  const log = vi.fn(); let state: ReactionState = { status: 'idle' };
  const acknowledge = vi.fn(async (input: DisplayedRequest, _signal: AbortSignal): Promise<DisplayedResponse> => ({ status: 'accepted', decisionId: input.decisionId }));
  const stream = new ReactionStream({ log, acknowledge, onState: (value) => { state = value; },
    request: (input, signal) => new Promise((resolve) => calls.push({ input, signal, resolve })) });
  const respond = async (index = 0, patch: Partial<ReactionReply> = {}) => {
    const input = calls[index].input;
    const reply: ReactionReply = { ...input, emotion: 'sad', requestId: 'response', latencyMs: 20, status: 'replied',
      decisionId: input.turnId, phraseId: 'support_here', text: "I'm here.", expiresAt: Date.now() + 5000, displayMs: 2500, animationGapMs: 5000, ...patch };
    calls[index].resolve(reply); await Promise.resolve(); await Promise.resolve(); return reply;
  };
  const skip = async (index = 0) => {
    calls[index].resolve({ ...calls[index].input, requestId: 'skip', latencyMs: 1, status: 'skipped', reason: 'unstable_emotion' });
    await Promise.resolve(); await Promise.resolve();
  };
  stream.begin('session'); stream.setEnabled(true);
  return { stream, calls, acknowledge, log, respond, skip, state: () => state };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('display-only browser stream', () => {
  it('sends only one fragment and identities, and acknowledges only after the renderer reports a paint', async () => {
    const h = harness(); h.stream.append('session', speech());
    expect(Object.keys(h.calls[0].input).sort()).toEqual(['clientId', 'sessionId', 'generation', 'turnId', 'sequence', 'emotion', 'isSpeech', 'canDisplay'].sort());
    expect(h.state()).toEqual({ status: 'waiting' });
    const result = await h.respond(); expect(h.acknowledge).not.toHaveBeenCalled();
    h.stream.painted('wrong'); expect(h.acknowledge).not.toHaveBeenCalled();
    h.stream.painted(result.decisionId); h.stream.painted(result.decisionId);
    expect(h.acknowledge).toHaveBeenCalledTimes(1);
    expect(h.acknowledge.mock.calls[0][0]).toEqual({ clientId: result.clientId, sessionId: result.sessionId, generation: result.generation, decisionId: result.decisionId });
    await vi.advanceTimersByTimeAsync(2000); h.stream.painted(result.decisionId);
    await vi.advanceTimersByTimeAsync(500); expect(h.state()).toEqual({ status: 'idle' });
    expect(h.acknowledge).toHaveBeenCalledTimes(1);
  });
  it('forwards canDisplay=false while displaying and during the animation gap, without scheduling a later decision', async () => {
    const h = harness(); h.stream.append('session', speech()); const reply = await h.respond(); h.stream.painted(reply.decisionId);
    h.stream.append('session', speech()); expect(h.calls[1].input.canDisplay).toBe(false); await h.skip(1);
    expect(h.state().status).toBe('replied');
    await vi.advanceTimersByTimeAsync(2500); h.stream.append('session', speech());
    expect(h.calls[2].input.canDisplay).toBe(false); await h.skip(2);
    await vi.advanceTimersByTimeAsync(5000); expect(h.calls).toHaveLength(3);
    h.stream.append('session', speech()); expect(h.calls[3].input.canDisplay).toBe(true);
  });
  it('retains only the latest unsent fragment, preserves a compatible request and flushes a final fragment after stop', async () => {
    const h = harness(); h.stream.append('session', speech());
    h.stream.append('session', speech()); h.stream.append('session', speech());
    expect(h.calls).toHaveLength(1); expect(h.calls[0].signal.aborted).toBe(false);
    h.stream.complete('session'); await h.skip();
    expect(h.calls).toHaveLength(2); expect(h.calls[1].input.sequence).toBe(3);
    h.stream.append('session', speech()); expect(h.calls).toHaveLength(2);
    const reply = await h.respond(1); expect(h.state()).toMatchObject({ status: 'replied', decisionId: reply.decisionId });
  });
  it('aborts incompatible emotion, drops its result and sends the newest label without browser aggregation', async () => {
    const h = harness(); h.stream.append('session', speech()); h.stream.append('session', speech('happy'));
    expect(h.calls[0].signal.aborted).toBe(true); await h.respond();
    expect(h.calls).toHaveLength(2); expect(h.calls[1].input.emotion).toBe('happy');
    expect(h.state().status).toBe('waiting'); expect(h.acknowledge).not.toHaveBeenCalled();
  });
  it.each(['disable', 'reset', 'hidden', 'new-session', 'dispose'] as const)('drops late responses after %s', async (action) => {
    const h = harness(); h.stream.append('session', speech());
    if (action === 'disable') h.stream.setEnabled(false);
    if (action === 'reset') h.stream.reset();
    if (action === 'hidden') h.stream.setVisible(false);
    if (action === 'new-session') h.stream.begin('new');
    if (action === 'dispose') h.stream.dispose();
    expect(h.calls[0].signal.aborted).toBe(true); await h.respond();
    expect(h.state().status).not.toBe('replied'); expect(h.acknowledge).not.toHaveBeenCalled();
  });
  it('preserves the page identity across clear, enable and new recordings, while incrementing generations', async () => {
    const h = harness(); h.stream.append('session', speech()); await h.skip(); const original = h.calls[0].input;
    h.stream.reset(); h.stream.append('session', speech()); await h.skip(1);
    h.stream.setEnabled(false); h.stream.setEnabled(true); h.stream.append('session', speech()); await h.skip(2);
    h.stream.begin('second'); h.stream.append('second', speech());
    expect(h.calls.map((call) => call.input.clientId)).toEqual(Array(4).fill(original.clientId));
    expect(h.calls.map((call) => call.input.generation)).toEqual([2, 3, 5, 6]);
    expect(h.calls.at(-1)!.input.sequence).toBe(1);
  });
  it('clears a hidden display and waits for new recognition on visibility restore', async () => {
    const h = harness(); h.stream.append('session', speech()); const reply = await h.respond(); h.stream.painted(reply.decisionId);
    h.stream.setVisible(false); expect(h.state().status).toBe('idle'); h.stream.append('session', speech());
    h.stream.setVisible(true); await vi.advanceTimersByTimeAsync(60_000); expect(h.calls).toHaveLength(1);
    h.stream.append('session', speech()); expect(h.calls).toHaveLength(2);
  });
  it('rejects recognition that was already in flight when the task generation changed', () => {
    const h = harness(); const oldGeneration = h.stream.captureGeneration();
    h.stream.reset(); h.stream.append('session', speech(), oldGeneration);
    expect(h.calls).toHaveLength(0);
    h.stream.append('session', speech(), h.stream.captureGeneration()); expect(h.calls).toHaveLength(1);
  });
  it('expires unpainted and already expired replies without counting a display', async () => {
    const h = harness(); h.stream.append('session', speech()); await h.respond();
    await vi.advanceTimersByTimeAsync(5000); expect(h.state().status).toBe('idle'); expect(h.acknowledge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); h.stream.append('session', speech()); await h.respond(1, { expiresAt: Date.now() - 1 });
    expect(h.state().status).toBe('idle'); expect(h.acknowledge).not.toHaveBeenCalled();
  });
  it('makes only finite acknowledgement retries and cancels them when the display is cleared', async () => {
    const h = harness(); h.acknowledge.mockRejectedValue(new Error('network'));
    h.stream.append('session', speech()); const reply = await h.respond(); h.stream.painted(reply.decisionId);
    await vi.advanceTimersByTimeAsync(2000); expect(h.acknowledge).toHaveBeenCalledTimes(3);
    h.stream.reset(); await vi.advanceTimersByTimeAsync(20_000); expect(h.acknowledge).toHaveBeenCalledTimes(3);
  });
  it('does not call the endpoint when disabled and lets unknown/non-speech reach server rules when enabled', () => {
    const h = harness(); h.stream.setEnabled(false); h.stream.append('session', speech()); expect(h.calls).toHaveLength(0);
    h.stream.setEnabled(true); h.stream.append('session', { ...speech('unknown'), isSpeech: false });
    expect(h.calls[0].input).toMatchObject({ emotion: 'unknown', isSpeech: false });
  });
});

it('validates server reply ownership and display text at the browser transport boundary', async () => {
  const h = harness(); h.stream.append('session', speech()); const input = h.calls[0].input;
  const valid = { ...input, status: 'replied', decisionId: input.turnId, phraseId: 'new-csv-phrase', text: 'Stay close.', emotion: 'sad',
    requestId: 'req', latencyMs: 10, expiresAt: Date.now() + 5000, displayMs: 2500, animationGapMs: 5000 };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(valid))));
  expect(await requestReaction(input, new AbortController().signal)).toMatchObject({ text: 'Stay close.' });
  for (const patch of [{ text: 'Too many words here.' }, { generation: -1 }, { decisionId: 'other' }, { emotion: 'happy' }, { sequence: 999 }]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...valid, ...patch }))));
    await expect(requestReaction(input, new AbortController().signal)).rejects.toThrow();
  }
});
