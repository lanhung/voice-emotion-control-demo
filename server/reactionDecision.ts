import type { CatalogPhrase } from '../shared/reactionCatalog';
import type { LayaScores } from './laya';
import { reactionPolicy as policy } from './reactionPolicy';

export interface WeightedCandidate { phrase: CatalogPhrase; recentCount: number; adjustedWeight: number; finalWeight: number; probability: number }
export function weightCandidates(candidates: readonly CatalogPhrase[], recentCount: (id: string) => number, scores: LayaScores): WeightedCandidate[] {
  const rows = candidates.map((phrase) => {
    const count = recentCount(phrase.id);
    const adjustedWeight = phrase.weight / (1 + count);
    return { phrase, recentCount: count, adjustedWeight,
      finalWeight: adjustedWeight * ((1 - policy.modelMix) * scores.probabilities[phrase.id] + policy.modelMix / candidates.length), probability: 0 };
  });
  // Scaling before summation supports any finite positive CSV weight without overflowing.
  const logs = rows.map((row) => Math.log(row.phrase.weight) - Math.log1p(row.recentCount)
    + Math.log((1 - policy.modelMix) * scores.probabilities[row.phrase.id] + policy.modelMix / candidates.length));
  const scale = Math.max(...logs);
  const scaled = logs.map((value) => Math.exp(value - scale));
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return rows.map((row, index) => ({ ...row, probability: scaled[index] / total }));
}
export function drawCandidate(rows: readonly WeightedCandidate[], random: () => number): CatalogPhrase {
  const target = random();
  if (!Number.isFinite(target) || target < 0 || target >= 1 || rows.length === 0) throw new Error('Invalid random draw');
  let cumulative = 0;
  for (const row of rows) { cumulative += row.probability; if (target < cumulative) return row.phrase; }
  return rows[rows.length - 1].phrase;
}
