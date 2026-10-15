import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult } from '../shared/emotions';
import { REACTION_ANIMATION_GAP_MS, REACTION_COALESCE_MS, REACTION_DISPLAY_MS, REACTION_MIN_INTERVAL_MS,
  type ReactionRequest, type ReactionResponse } from '../shared/reaction';
import { ReactionStream, type ReactionState } from '../src/reaction/stream';

const speech = (text = '我考上了！'): AnalysisResult => ({ text, emotion: 'happy', durationMs: 2500,
  language: 'zh', events: [], isSpeech: true, latencyMs: 10, tags: ['zh', 'HAPPY', 'Speech'], emotionTag: 'HAPPY' });
function setup(enabled = true) {
  const calls: { input: ReactionRequest; signal: AbortSignal; at: number; resolve: (value: ReactionResponse) => void }[] = [];
  const log = vi.fn();
  let state: ReactionState = { status: 'idle' };
  const stream = new ReactionStream({ log, onState: (value) => { state = value; },
    request: (input, signal) => new Promise((resolve) => calls.push({ input, signal, at: Date.now(), resolve })) });
  stream.setEnabled(enabled); stream.begin('session');
  const respond = async (index = 0, patch: Partial<ReactionResponse> = {}) => {
    const call = calls[index];
    call.resolve({ sessionId: call.input.sessionId, turnId: call.input.turnId, requestId: `request-${index}`,
      latencyMs: 20, status: 'replied', text: 'Congrats!', modelOutput: 'Congrats!', ...patch } as ReactionResponse);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { stream, calls, log, respond, state: () => state };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

describe('near-real-time reactions', () => {
  it('responds and logs the actual phrase while recording, then expires from arrival without duplicate stop requests', async () => {
    const { stream, calls, log, respond, state } = setup();
    stream.append('session', speech());
    await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(log).toHaveBeenCalledWith('reaction.requested', expect.any(String), expect.objectContaining({ trigger: 'recognition' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(state().status).toBe('waiting');
    await respond();
    expect(state()).toEqual({ status: 'replied', text: 'Congrats!' });
    expect(log).toHaveBeenCalledWith('reaction.received', '大模型回复：Congrats!', expect.objectContaining({ modelOutput: 'Congrats!', text: 'Congrats!' }));
    expect(log).toHaveBeenCalledWith('reaction.displayed', '已展示短回应：Congrats!', expect.objectContaining({ text: 'Congrats!' }));
    stream.complete('session'); stream.complete('session');
    await vi.advanceTimersByTimeAsync(REACTION_DISPLAY_MS - 1);
    expect(state().status).toBe('replied');
    await vi.advanceTimersByTimeAsync(1);
    expect(state().status).toBe('idle');
    expect(calls).toHaveLength(1);
  });

  it('coalesces new results while a slow request runs, includes negation, and processes the final tail exactly once', async () => {
    const { stream, calls, respond, state } = setup();
    stream.append('session', speech('我一直在准备考试，'));
    await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    stream.append('session', speech('最后没有考上。'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
    stream.append('session', speech('现在有点失落。'));
    stream.complete('session');
    await respond();
    await vi.advanceTimersByTimeAsync(REACTION_DISPLAY_MS);
    expect(state().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(REACTION_ANIMATION_GAP_MS - 1);
    expect(calls).toHaveLength(1); // Stop must respect the animation interval too.
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].input.text).toBe('我一直在准备考试，\n最后没有考上。\n现在有点失落。');
    expect(calls[0].signal.aborted).toBe(false);
    expect(calls[1].input.turnId).not.toBe(calls[0].input.turnId);
    await respond(1); await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toHaveLength(2);
  });

  it('still limits fast requests when the model returns NONE without starting a display interval', async () => {
    const { stream, calls, respond, state, log } = setup();
    stream.append('session', speech()); await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    await vi.advanceTimersByTimeAsync(1000);
    await respond(0, { status: 'skipped', reason: 'none', modelOutput: 'NONE' });
    expect(state().status).toBe('idle');
    stream.append('session', speech('谢谢你'));
    await vi.advanceTimersByTimeAsync(REACTION_MIN_INTERVAL_MS - 1001);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].at - calls[0].at).toBe(REACTION_MIN_INTERVAL_MS);
    expect(state().status).toBe('waiting');
    await respond(1, { status: 'skipped', reason: 'none', modelOutput: 'NONE' });
    expect(state().status).toBe('idle');
    expect(log).toHaveBeenCalledWith('reaction.received', '大模型回复：NONE', expect.objectContaining({ reason: 'none' }));
  });

  it('gives every reply a full animation interval, including repeated phrases, and uses the newest recognition', async () => {
    const { stream, calls, respond, state } = setup();
    stream.append('session', speech()); await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    await respond();
    stream.append('session', speech('显示文字时说的内容'));
    await vi.advanceTimersByTimeAsync(REACTION_DISPLAY_MS - 1);
    expect(state()).toEqual({ status: 'replied', text: 'Congrats!' });
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(REACTION_ANIMATION_GAP_MS - 1);
    stream.append('session', speech('动画期间最新的补充'));
    expect(calls).toHaveLength(1);
    expect(state().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].input.text).toContain('显示文字时说的内容\n动画期间最新的补充');
    expect(calls[1].at - calls[0].at).toBe(REACTION_DISPLAY_MS + REACTION_ANIMATION_GAP_MS);
    await respond(1); // The same phrase is a new display, not an extension of the first.
    expect(state()).toEqual({ status: 'replied', text: 'Congrats!' });
    stream.append('session', speech('继续说话'));
    await vi.advanceTimersByTimeAsync(REACTION_DISPLAY_MS);
    expect(state().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(REACTION_ANIMATION_GAP_MS - 1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
  });

  it.each(['new-recording', 'disable', 'clear', 'dispose'] as const)('cancels recognition queued during the animation interval after %s', async (action) => {
    const { stream, calls, respond } = setup();
    stream.append('session', speech()); await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    await respond();
    stream.append('session', speech('等待下一次回应的内容'));
    await vi.advanceTimersByTimeAsync(REACTION_DISPLAY_MS + 1000);
    if (action === 'new-recording') stream.begin('next-session');
    if (action === 'disable') stream.setEnabled(false);
    if (action === 'clear') stream.reset();
    if (action === 'dispose') stream.dispose();
    if (action === 'new-recording') {
      stream.append('next-session', speech('全新录音'));
      await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
      expect(calls).toHaveLength(2);
      expect(calls[1].input.text).toBe('全新录音');
    }
    await vi.advanceTimersByTimeAsync(40000);
    expect(calls).toHaveLength(action === 'new-recording' ? 2 : 1);
  });

  it('starts the animation interval when a delayed display timer actually clears the text', async () => {
    const { stream, calls, respond, state } = setup();
    stream.append('session', speech()); await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    await respond();
    stream.append('session', speech('暂停期间的新内容'));
    vi.setSystemTime(Date.now() + 60000); // A suspended browser has not run the display timer yet.
    await vi.advanceTimersByTimeAsync(REACTION_DISPLAY_MS);
    expect(state().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(REACTION_ANIMATION_GAP_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
  });

  it('can be enabled during recording and ignores silence, punctuation and other sessions', async () => {
    const { stream, calls } = setup(false);
    stream.append('session', speech('开启之前')); await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
    stream.setEnabled(true);
    stream.append('old-session', speech());
    stream.append('session', { ...speech('笑声'), isSpeech: false });
    stream.append('session', speech('……'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
    stream.append('session', speech('开启之后'));
    await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    expect(calls[0].input.text).toBe('开启之后');
  });

  it.each(['new-recording', 'disable', 'clear', 'dispose'] as const)('cancels pending work and discards late transport results after %s', async (action) => {
    const { stream, calls, respond, state, log } = setup();
    stream.append('session', speech()); await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    stream.append('session', speech('排队中的片段'));
    if (action === 'new-recording') stream.begin('next-session');
    if (action === 'disable') stream.setEnabled(false);
    if (action === 'clear') stream.reset();
    if (action === 'dispose') stream.dispose();
    const previousState = state();
    expect(calls[0].signal.aborted).toBe(true);
    await respond(); await vi.advanceTimersByTimeAsync(40000);
    expect(calls).toHaveLength(1);
    expect(state()).toEqual(previousState);
    expect(log.mock.calls.some(([event]) => event === 'reaction.displayed')).toBe(false);
  });

  it('recovers from a failed request when new speech arrives, without retrying idle content', async () => {
    const { stream, calls, respond, state } = setup();
    stream.append('session', speech()); await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    await respond(0, { status: 'error', code: 'timeout', error: 'timeout' });
    expect(state()).toMatchObject({ status: 'error' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toHaveLength(1);
    stream.append('session', speech('新的表达'));
    await vi.advanceTimersByTimeAsync(REACTION_COALESCE_MS);
    expect(calls[1].input.text).toBe('新的表达');
    await respond(1);
    expect(state().status).toBe('replied');
  });

  it('flushes unsent recognition at stop, including sub-window recordings', async () => {
    const { stream, calls } = setup();
    stream.append('session', speech('不到两秒的一句话'));
    stream.complete('session');
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].input.text).toBe('不到两秒的一句话');
    stream.append('session', speech('停止后忽略'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toHaveLength(1);
  });
});
