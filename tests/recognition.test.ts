import { describe, expect, it } from 'vitest';
import { parseRecognition } from '../server/sensevoice';

describe('SenseVoice result interpretation', () => {
  it('takes emotion from acoustic tags without inferring sentiment from words', () => {
    expect(parseRecognition({ result: [{ raw_text: '<|zh|><|SAD|><|Speech|><|withitn|>今天很开心。' }] }))
      .toEqual({ text: '今天很开心。', emotion: 'sad', language: 'zh', events: [], isSpeech: true,
        emotionTag: 'SAD', tags: ['zh', 'SAD', 'Speech', 'withitn'] });
  });
  it.each(['HAPPY', 'SAD', 'ANGRY', 'NEUTRAL', 'FEARFUL', 'DISGUSTED', 'SURPRISED'])('recognizes %s', (tag) => {
    expect(parseRecognition({ result: [{ raw_text: `<|${tag}|>hello` }] }).emotion).toBe(tag.toLowerCase());
  });
  it('keeps unknown emotion distinct from neutral and does not fabricate confidence', () => {
    const result = parseRecognition({ result: [{ raw_text: '<|EMO_UNKNOWN|>声音' }] });
    expect(result.emotion).toBe('unknown'); expect(result).not.toHaveProperty('confidence');
    expect(parseRecognition({ result: [{ text: '无标签文本' }] }).emotion).toBe('unknown');
  });
  it('suppresses no-speech text while preserving sound events', () => {
    expect(parseRecognition({ result: [{ raw_text: '<|nospeech|><|HAPPY|><|Laughter|>幻觉文字' }] }))
      .toEqual({ text: '', emotion: 'happy', language: null, events: ['笑声'], isSpeech: false,
        emotionTag: 'HAPPY', tags: ['nospeech', 'HAPPY', 'Laughter'] });
  });
  it('handles empty inference without displaying fabricated text', () => {
    expect(parseRecognition({ result: [] }).isSpeech).toBe(false);
    expect(() => parseRecognition({ invalid: true })).toThrow();
  });
  it('preserves actual model inference and queue timings', () => {
    const result = parseRecognition({ result: [{ raw_text: '<|EMO_UNKNOWN|>test' }], timings: { inferenceMs: 142, queueMs: 3 } });
    expect(result).toMatchObject({ emotionTag: 'EMO_UNKNOWN', inference: { inferenceMs: 142, queueMs: 3 } });
  });
});
