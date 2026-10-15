import { describe, expect, it } from 'vitest';
import { reactionRequestSchema, validateReaction } from '../server/reaction';
import { readLlmConfig } from '../server/llm';
import { isReactionPhrase, MAX_REACTION_TEXT_LENGTH, reactionPhrases } from '../shared/reaction';
import { appendReactionContext, createReactionContext, reactionContextRequest, MAX_CONTEXT_SEGMENTS } from '../src/reaction/context';
import type { AnalysisResult } from '../shared/emotions';

const result = (text: string, emotion: AnalysisResult['emotion'] = 'happy', durationMs = 2500): AnalysisResult => ({
  text, emotion, durationMs, language: 'zh', events: [], isSpeech: true, latencyMs: 12, tags: ['Speech'], emotionTag: 'HAPPY',
});

describe('short reaction rules', () => {
  it.each(reactionPhrases)('accepts the canonical one or two word phrase %s', (text) => {
    expect(isReactionPhrase(text)).toBe(true);
    expect(validateReaction(text, 'stop')).toEqual({ status: 'replied', text });
  });
  it('normalizes only whitespace and curly apostrophes, and hides NONE', () => {
    expect(validateReaction('  I’m here.\n', 'stop')).toEqual({ status: 'replied', text: "I'm here." });
    expect(validateReaction('NONE', 'stop')).toEqual({ status: 'skipped', reason: 'none' });
  });
  it.each(['', null, "You've got this.", 'Congrats! Because you passed.', 'Congrats!\nAwesome!', '"Congrats!"', 'congrats!', 'Congrats! 🎉', '祝贺你', 'NОNE'])('rejects invalid output %s without truncating', (text) => {
    expect(validateReaction(text, 'stop')).toEqual({ status: 'skipped', reason: 'invalid_output' });
  });
  it.each(['length', 'content_filter', 'tool_calls', null, undefined])('rejects incomplete finish reason %s even with a valid phrase', (finishReason) => {
    expect(validateReaction('Congrats!', finishReason)).toEqual({ status: 'skipped', reason: 'incomplete_output' });
  });
  it('rejects refusals and browser-supplied upstream configuration', () => {
    expect(validateReaction('Congrats!', 'stop', 'refused')).toEqual({ status: 'skipped', reason: 'incomplete_output' });
    const input = { sessionId: 'session', turnId: 'turn', text: '我考上了', emotion: 'happy' };
    expect(reactionRequestSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ baseURL: 'http://example.com' }, { apiKey: 'key' }, { systemPrompt: 'override' },
      { emotion: 'invented' }, { text: '好'.repeat(MAX_REACTION_TEXT_LENGTH + 1) }, { turnId: '../bad' }]) {
      expect(reactionRequestSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it('keeps absent and invalid server configuration disabled', () => {
    expect(readLlmConfig({})).toBeNull();
    expect(readLlmConfig({ LLM_API_KEY: ' ' })).toBeNull();
    expect(readLlmConfig({ LLM_API_KEY: 'test', LLM_BASE_URL: 'file:///tmp/model' })).toBeNull();
    expect(readLlmConfig({ LLM_API_KEY: 'test', LLM_TIMEOUT_MS: '0' })).toBeNull();
    expect(readLlmConfig({ LLM_API_KEY: 'test' })).toMatchObject({ model: 'gpt-6-luna', timeoutMs: 10000 });
  });
});

describe('rolling recognition context', () => {
  it('bounds long recordings, includes recent negation and the tail, and ignores non-speech events', () => {
    const context = createReactionContext();
    for (let i = 0; i < 121; i++) appendReactionContext(context, result(`第${i}段`));
    appendReactionContext(context, { ...result('笑声'), isSpeech: false, events: ['laughter'] });
    appendReactionContext(context, result('最后没有考上。', 'sad', 300));
    const request = reactionContextRequest(context, 'session', 'turn');
    expect(context.segments).toHaveLength(MAX_CONTEXT_SEGMENTS);
    expect(request.text).not.toContain('第0段');
    expect(request.text).toMatch(/第120段\n最后没有考上。$/);
    expect(request.text).not.toContain('笑声');
    expect(request.emotion).toBe('happy'); // Acoustic hint stays separate from negated semantics.
  });
  it('uses speech duration for the hint, drops whole old segments, and rejects oversized segments without truncating', () => {
    const context = createReactionContext();
    appendReactionContext(context, result('准备出门', 'happy', 500));
    appendReactionContext(context, result('但我很紧张', 'fearful', 2000));
    expect(appendReactionContext(context, result('……', 'unknown', 2500))).toBe('ignored');
    expect(reactionContextRequest(context, 'session', 'turn').emotion).toBe('fearful');
    appendReactionContext(context, result('好'.repeat(MAX_REACTION_TEXT_LENGTH)));
    expect(context.segments).toHaveLength(1);
    expect(reactionContextRequest(context, 'session', 'turn').text).toHaveLength(MAX_REACTION_TEXT_LENGTH);
    expect(appendReactionContext(context, result('好'.repeat(MAX_REACTION_TEXT_LENGTH + 1)))).toBe('too_long');
    expect(context.segments).toEqual([]);
    expect(appendReactionContext(context, result('新的表达'))).toBe('accepted');
  });
});
