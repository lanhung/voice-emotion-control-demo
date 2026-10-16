export const MATRIX_ROWS = 8;
export const MATRIX_COLUMNS = 64;

// A condensed 7-row alphabet keeps short replies, including punctuation,
// on the physical 64-column display without scrolling or dropping letters.
const glyphs: Record<string, readonly string[]> = {
  A: ['0110', '1001', '1001', '1111', '1001', '1001', '1001'],
  B: ['1110', '1001', '1001', '1110', '1001', '1001', '1110'],
  C: ['0111', '1000', '1000', '1000', '1000', '1000', '0111'],
  D: ['1110', '1001', '1001', '1001', '1001', '1001', '1110'],
  E: ['1111', '1000', '1000', '1110', '1000', '1000', '1111'],
  F: ['1111', '1000', '1000', '1110', '1000', '1000', '1000'],
  G: ['0111', '1000', '1000', '1011', '1001', '1001', '0111'],
  H: ['1001', '1001', '1001', '1111', '1001', '1001', '1001'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  J: ['0011', '0001', '0001', '0001', '1001', '1001', '0110'],
  K: ['1001', '1001', '1010', '1100', '1010', '1001', '1001'],
  L: ['1000', '1000', '1000', '1000', '1000', '1000', '1111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['1001', '1001', '1101', '1101', '1011', '1001', '1001'],
  O: ['0110', '1001', '1001', '1001', '1001', '1001', '0110'],
  P: ['1110', '1001', '1001', '1110', '1000', '1000', '1000'],
  Q: ['0110', '1001', '1001', '1001', '1011', '0110', '0001'],
  R: ['1110', '1001', '1001', '1110', '1010', '1001', '1001'],
  S: ['0111', '1000', '1000', '0110', '0001', '0001', '1110'],
  T: ['1111', '0110', '0110', '0110', '0110', '0110', '0110'],
  U: ['1001', '1001', '1001', '1001', '1001', '1001', '0110'],
  V: ['10001', '10001', '10001', '01010', '01010', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['1001', '1001', '0110', '0110', '0110', '1001', '1001'],
  Y: ['1001', '1001', '1001', '0110', '0110', '0110', '0110'],
  Z: ['1111', '0001', '0010', '0110', '0100', '1000', '1111'],
  '!': ['1', '1', '1', '1', '1', '0', '1'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  "'": ['1', '1', '0', '0', '0', '0', '0'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
};

export interface MatrixText { pixels: Uint8Array; width: number; offset: number }

function textGlyphs(text: string) {
  return [...text.toUpperCase()].map((letter) => {
    const glyph = glyphs[letter];
    if (!glyph) throw new Error(`Unsupported matrix letter: ${letter}`);
    return glyph;
  });
}

export function measureMatrixText(text: string): number {
  return Math.max(0, textGlyphs(text).reduce((sum, glyph) => sum + glyph[0].length + 1, -1));
}

export function layoutMatrixText(text: string): MatrixText {
  const letters = textGlyphs(text);
  const width = measureMatrixText(text);
  if (width > MATRIX_COLUMNS) throw new Error('Reaction does not fit the light matrix');
  const offset = Math.floor((MATRIX_COLUMNS - width) / 2);
  const pixels = new Uint8Array(MATRIX_COLUMNS * MATRIX_ROWS);
  let x = offset;
  for (const glyph of letters) {
    glyph.forEach((line, row) => {
      [...line].forEach((bit, column) => { pixels[row * MATRIX_COLUMNS + x + column] = Number(bit); });
    });
    x += glyph[0].length + 1;
  }
  return { pixels, width, offset };
}
