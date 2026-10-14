import { expect, it } from 'vitest';
import { measureSignal, toDbfs } from '../shared/monitoring';

it('reports actual dBFS and clipping without NaN for silent input', () => {
  expect(measureSignal(new Float32Array(40000))).toEqual({ rms: 0, peak: 0, dbfs: -96, clippedPercent: 0 });
  const signal = measureSignal(new Float32Array([0.1, -0.1]));
  expect(signal.dbfs).toBe(-20); expect(signal.peak).toBeCloseTo(0.1);
  expect(measureSignal(new Float32Array([1, -1, 0, 0])).clippedPercent).toBe(50);
  expect(toDbfs(0)).toBe(-96);
});
