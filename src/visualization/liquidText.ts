import type { ReactionPhrase } from '../../shared/reaction';

export const LIQUID_MORPH_MS = 650;
interface Point { x: number; y: number }
export interface LiquidLetterPoint extends Point { fromX: number; fromY: number; bend: number }
export interface LiquidTextShape {
  mask: HTMLCanvasElement;
  points: LiquidLetterPoint[];
  radius: number;
  dotRadius: number;
  top: number;
  bottom: number;
}

// Sample locally bundled type rather than fetching fonts or sending the reply out.
// The final mask retains smooth glyph edges; droplets only provide the transition.
export function createLiquidTextShape(text: ReactionPhrase, width: number, height: number): LiquidTextShape | null {
  const mask = document.createElement('canvas');
  mask.width = Math.ceil(width); mask.height = Math.ceil(height);
  const context = mask.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const font = (size: number) => `750 ${size}px "DM Sans", sans-serif`;
  const maximum = Math.min(112, height * 0.38);
  context.font = font(maximum);
  const size = maximum * Math.min(1, (width - 36) / Math.max(1, context.measureText(text).width));
  context.font = font(size);
  const metrics = context.measureText(text);
  const baseline = height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  const top = baseline - metrics.actualBoundingBoxAscent;
  const bottom = baseline + metrics.actualBoundingBoxDescent;
  context.textAlign = 'center';
  context.fillStyle = '#fff';
  context.fillText(text, width / 2, baseline);
  const pixels = context.getImageData(0, 0, mask.width, mask.height).data;
  // Bound the particle count on large and immersive displays.
  const spacing = Math.max(2, size / 26);
  const targets: Point[] = [];
  for (let x = spacing / 2; x < width; x += spacing) {
    for (let y = Math.max(0, top); y < bottom; y += spacing) {
      if (pixels[(Math.floor(y) * mask.width + Math.floor(x)) * 4 + 3] > 100) targets.push({ x, y });
    }
  }
  const radius = Math.min(height * 0.37, width * 0.29);
  const origins = targets.map((_, index) => {
    const distance = radius * Math.sqrt((index + 0.5) / targets.length);
    const angle = index * 2.399963229728653;
    return { x: width / 2 + Math.cos(angle) * distance, y: height / 2 + Math.sin(angle) * distance };
  }).sort((a, b) => a.x - b.x);
  return {
    mask, radius, dotRadius: spacing * 0.78, top, bottom,
    points: targets.map((point, index) => ({ ...point, fromX: origins[index].x, fromY: origins[index].y, bend: Math.sin(index * 1.7) * radius * 0.28 })),
  };
}

export function liquidMorphProgress(elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const progress = Math.max(0, Math.min(1, elapsedMs / LIQUID_MORPH_MS));
  return progress * progress * (3 - 2 * progress);
}
