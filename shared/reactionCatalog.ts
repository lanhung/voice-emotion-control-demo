import { z } from 'zod';
import { MATRIX_COLUMNS, measureMatrixText } from './matrixGlyphs';

export const MAX_EMOTION_CANDIDATES = 20;
export const catalogColumns = ['id', 'text', 'emotions', 'weight', 'cooldown_seconds', 'enabled'] as const;
export const normalizePhrase = (text: string) => text.trim().replace(/[‘’]/g, "'");
export const phraseKey = (text: string) => normalizePhrase(text).toLowerCase().replace(/[.!]$/, '');
export function isReactionPhrase(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]+(?:'[A-Za-z]+)*(?: [A-Za-z]+(?:'[A-Za-z]+)*)?[!.]?$/.test(value)
    && measureMatrixText(value) <= MATRIX_COLUMNS;
}
export const catalogEmotionSchema = z.enum(['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted']);
export type CatalogEmotion = z.infer<typeof catalogEmotionSchema>;
export const catalogRowSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'expected 1–64 letters, digits, underscores or hyphens'),
  text: z.string().transform(normalizePhrase).refine(isReactionPhrase, 'expected 1–2 English words fitting 64 matrix columns'),
  emotions: z.string().transform((value) => value.split('|')).pipe(z.array(catalogEmotionSchema).min(1))
    .refine((values) => new Set(values).size === values.length, 'duplicate emotion'),
  weight: z.string().min(1).transform(Number).pipe(z.number().finite().positive()),
  cooldown_seconds: z.string().regex(/^\d+$/, 'expected a nonnegative integer').transform(Number).pipe(
    z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000))),
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true'),
}).strict();
export type CatalogPhrase = z.infer<typeof catalogRowSchema>;
