import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, CsvError } from 'csv-parse/sync';
import { z } from 'zod';
import { catalogColumns, catalogRowSchema, MAX_EMOTION_CANDIDATES, phraseKey,
  type CatalogEmotion, type CatalogPhrase } from '../shared/reactionCatalog';

export interface ReactionCatalog { version: string; phrases: readonly CatalogPhrase[]; maxCooldownMs: number }
export class CatalogError extends Error {
  constructor(readonly code: 'catalog_missing' | 'catalog_invalid', message: string) { super(message); }
}
const csvRecordsSchema = z.array(z.object({ record: z.array(z.string()), info: z.object({ lines: z.number().int() }) }));
export function parseReactionCatalog(csv: string, path = 'config/reaction-phrases.csv'): ReactionCatalog {
  const fail = (line: number, field: string, reason: string): never => {
    throw new CatalogError('catalog_invalid', `${path}:${line} [${field}]: ${reason}`);
  };
  let records: z.infer<typeof csvRecordsSchema>;
  try {
    records = csvRecordsSchema.parse(parse(csv, { bom: true, skip_empty_lines: true, trim: true, info: true, relax_column_count: true }));
  } catch (error) {
    return fail(error instanceof CsvError && typeof error.lines === 'number' ? error.lines : 1, 'csv', error instanceof Error ? error.message : 'invalid CSV');
  }
  const header = records.shift();
  if (!header) return fail(1, 'header', 'missing header');
  const columns = header.record;
  if (new Set(columns).size !== columns.length) return fail(header.info.lines, 'header', 'duplicate column');
  for (const column of catalogColumns) if (!columns.includes(column)) return fail(header.info.lines, column, 'missing column');
  for (const column of columns) if (!catalogColumns.some((known) => known === column)) return fail(header.info.lines, column, 'unknown column');
  const ids = new Set<string>(); const texts = new Set<string>();
  const counts = new Map<CatalogEmotion, number>();
  const phrases: CatalogPhrase[] = [];
  for (const { record, info } of records) {
    if (record.length !== columns.length) return fail(info.lines, 'csv', `expected ${columns.length} columns, received ${record.length}`);
    const parsed = catalogRowSchema.safeParse(Object.fromEntries(columns.map((column, index) => [column, record[index]])));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(info.lines, issue.path.join('.'), issue.message);
    }
    const phrase = parsed.data;
    if (ids.has(phrase.id)) return fail(info.lines, 'id', 'duplicate ID');
    if (texts.has(phraseKey(phrase.text))) return fail(info.lines, 'text', 'duplicate normalized phrase');
    ids.add(phrase.id); texts.add(phraseKey(phrase.text));
    if (phrase.enabled) for (const emotion of phrase.emotions) {
      const count = (counts.get(emotion) ?? 0) + 1;
      if (count > MAX_EMOTION_CANDIDATES) return fail(info.lines, 'emotions', `${emotion} exceeds ${MAX_EMOTION_CANDIDATES} enabled phrases`);
      counts.set(emotion, count);
    }
    phrases.push(phrase);
  }
  const canonical = phrases.map((phrase) => ({ ...phrase, emotions: [...phrase.emotions].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  return { phrases, version: createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16),
    maxCooldownMs: Math.max(0, ...phrases.map((phrase) => phrase.cooldown_seconds * 1000)) };
}
export async function loadReactionCatalog(path = process.env.REACTION_CATALOG_PATH ?? 'config/reaction-phrases.csv'): Promise<ReactionCatalog> {
  let csv: string;
  try { csv = await readFile(path, 'utf8'); }
  catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    throw new CatalogError(missing ? 'catalog_missing' : 'catalog_invalid', `${path}: ${missing ? 'file not found' : 'cannot read catalog'}`);
  }
  return parseReactionCatalog(csv, path);
}
