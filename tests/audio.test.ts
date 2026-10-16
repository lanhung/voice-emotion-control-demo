import { describe, expect, it } from 'vitest';
import { encodeWav, resample } from '../src/audio/wav';
import { wavDuration } from '../server/sensevoice';

describe('microphone audio transport', () => {
  it.each([44100, 48000, 16000].flatMap((rate) => [2.5, 5].map((seconds) => ({ rate, seconds }))))(
    'preserves $seconds-second duration from $rate Hz input', ({ rate, seconds }) => {
    const samples = new Float32Array(rate * seconds).fill(0.25);
    const downsampled = resample(samples, rate);
    expect(downsampled.length).toBe(16000 * seconds);
    expect(downsampled[123]).toBeCloseTo(0.25);
    const wav = Buffer.from(encodeWav(downsampled));
    expect(wavDuration(wav)).toBe(seconds * 1000);
    expect(wav.readInt16LE(44)).toBe(8192);
  });
  it('clips PCM samples and encodes negative samples with the correct sign', () => {
    const samples = new Float32Array(1600); samples.set([-2, 2, -0.5, 0]);
    const bytes = Buffer.from(encodeWav(samples));
    expect([0, 1, 2, 3].map((i) => bytes.readInt16LE(44 + i * 2))).toEqual([-32768, 32767, -16384, 0]);
  });
  it('rejects empty, truncated, incorrect-rate and oversized audio', () => {
    expect(() => wavDuration(Buffer.alloc(0))).toThrow();
    const wav = Buffer.from(encodeWav(new Float32Array(40000)));
    expect(() => wavDuration(wav.subarray(0, -2))).toThrow();
    expect(() => wavDuration(Buffer.from(encodeWav(new Float32Array(40000), 48000)))).toThrow();
    expect(() => wavDuration(Buffer.from(encodeWav(new Float32Array(80001))))).toThrow();
  });
});
