import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { reactionResponseSchema } from '../../shared/reaction';
import { prepareReaction } from './reaction-fixture';

test('live AudioWorklet → SenseVoice feeds the server emotion decision flow', async ({ page }) => {
  test.skip(process.env.LIVE_REACTION_TEST !== 'true', 'Opt in with LIVE_REACTION_TEST=true and local SenseVoice/Ollama.');
  test.skip(!existsSync(process.env.TEST_AUDIO_PATH ?? '.artifacts/speech.wav'), 'Provide a public test audio sample.');
  test.setTimeout(60_000);
  await page.goto('/'); await expect(page.locator('.connection')).toContainText('本地模型已连接');
  await page.getByRole('checkbox', { name: '短回应' }).check();
  const responsePromise = page.waitForResponse('**/api/reaction/decision', { timeout: 35_000 });
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry').first()).toBeVisible({ timeout: 20_000 });
  const response = await responsePromise;
  const result = reactionResponseSchema.parse(await response.json());
  await test.info().attach('live-reaction', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(response.ok()).toBe(true); expect(result.status).not.toBe('error');
  // Natural speech can be neutral/unstable; do not relabel it to force a companion phrase.
  // LIVE_LAYA_TEST separately requires a real multi-candidate SDK decision.
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeEnabled();
});

test('controlled acoustic labels → real Laya SDK → renderer → accepted display receipt', async ({ page }) => {
  test.skip(process.env.LIVE_REACTION_TEST !== 'true', 'Requires the local Laya model.');
  test.setTimeout(60_000);
  await prepareReaction(page); // Only recognition is synthetic; both reaction endpoints are live.
  await page.getByRole('button', { name: /灯光矩阵/ }).click();
  await page.getByRole('checkbox', { name: '短回应' }).check();
  const decision = page.waitForResponse(async (response) => response.url().endsWith('/api/reaction/decision')
    && (await response.json()).status === 'replied', { timeout: 35_000 });
  const receipt = page.waitForResponse('**/api/reaction/displayed', { timeout: 35_000 });
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  const result = reactionResponseSchema.parse(await (await decision).json());
  expect(result.status).toBe('replied');
  if (result.status !== 'replied') throw new Error('Expected a real decision');
  await expect(page.getByTestId('reaction-badge')).toContainText(result.text);
  expect(await (await receipt).json()).toMatchObject({ status: 'accepted', decisionId: result.decisionId });
  await test.info().attach('laya-rendered-decision', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
});
