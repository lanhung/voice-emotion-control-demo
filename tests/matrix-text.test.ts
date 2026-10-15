import { describe, expect, it } from 'vitest';
import { reactionPhrases } from '../shared/reaction';
import { layoutMatrixText, MATRIX_COLUMNS, MATRIX_ROWS } from '../src/visualization/matrixText';

describe('reaction lettering on the physical light matrix', () => {
  it.each(reactionPhrases)('fits the complete phrase %s without clipping', (phrase) => {
    const { pixels, width, offset } = layoutMatrixText(phrase);
    expect(pixels.length).toBe(MATRIX_ROWS * MATRIX_COLUMNS);
    expect(width).toBeLessThanOrEqual(MATRIX_COLUMNS);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(Math.abs(offset - (MATRIX_COLUMNS - width - offset))).toBeLessThanOrEqual(1);
    expect(pixels.some((pixel) => pixel === 1)).toBe(true);
    // Both edges carry a complete glyph, including the final punctuation.
    expect(Array.from({ length: 7 }, (_, row) => pixels[row * MATRIX_COLUMNS + offset]).some(Boolean)).toBe(true);
    expect(pixels[6 * MATRIX_COLUMNS + offset + width - 1]).toBe(1);
    expect(pixels.slice(7 * MATRIX_COLUMNS).every((pixel) => pixel === 0)).toBe(true);
  });

  it('keeps the apostrophe and period in I’m here as distinct LED marks', () => {
    const { pixels, offset, width } = layoutMatrixText("I'm here.");
    const apostrophe = offset + 4; // Three-column I followed by one blank column.
    expect(Array.from({ length: 7 }, (_, row) => pixels[row * MATRIX_COLUMNS + apostrophe])).toEqual([1, 1, 0, 0, 0, 0, 0]);
    const period = offset + width - 1;
    expect(Array.from({ length: 7 }, (_, row) => pixels[row * MATRIX_COLUMNS + period])).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });
});
