import { expect, type Page, type Route } from '@playwright/test';
import type { ReactionRequest } from '../../shared/reaction';

export async function prepareReaction(page: Page, finalGate?: Promise<void>) {
  let segments = 0;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ready', model: 'SenseVoiceSmall', intervalMs: 2500 } }));
  await page.route('**/api/analyze', async (route) => {
    segments++;
    if (segments > 1 && finalGate) await finalGate;
    await route.fulfill({ json: { text: segments === 1 ? '私人转写只留在当前页面。' : '不同转写保持相同声学情绪。',
      emotion: 'sad', isSpeech: true, language: 'zh', events: [], tags: ['zh', 'SAD', 'Speech'], emotionTag: 'SAD', latencyMs: 12, durationMs: 2500 } });
  });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '跳过静音', exact: true }).uncheck();
}
export async function recordReactionRound(page: Page) {
  const before = await page.locator('[data-event="recognition.result"]').count();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('[data-event="recognition.result"]')).toHaveCount(before + 1, { timeout: 10_000 });
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
}
export function replyToDecision(route: Route, input: ReactionRequest, patch: Record<string, unknown> = {}) {
  return route.fulfill({ json: { clientId: input.clientId, sessionId: input.sessionId, generation: input.generation,
    turnId: input.turnId, sequence: input.sequence, requestId: 'test', latencyMs: 10, status: 'replied',
    decisionId: input.turnId, phraseId: 'support_here', text: "I'm here.", emotion: input.emotion,
    expiresAt: Date.now() + 5000, displayMs: 2500, animationGapMs: 5000, ...patch } });
}
