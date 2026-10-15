import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { isReactionPhrase, type ReactionResponse } from '../../shared/reaction';

test('live AudioWorklet → SenseVoice → cli-proxy returns a validated short reaction', async ({ page }) => {
  test.skip(process.env.LIVE_REACTION_TEST !== 'true', 'Opt in with LIVE_REACTION_TEST=true; this calls the configured live model.');
  test.skip(!existsSync(process.env.TEST_AUDIO_PATH ?? '.artifacts/speech.wav'), 'Provide a public test audio sample.');
  test.setTimeout(60_000);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/reaction')) requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.connection')).toContainText('本地模型已连接');
  await page.getByRole('checkbox', { name: '短回应' }).check();
  const responsePromise = page.waitForResponse('**/api/reaction', { timeout: 35_000 });
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry').first()).toBeVisible({ timeout: 20_000 });
  const response = await responsePromise;
  const result = await response.json() as ReactionResponse;
  await test.info().attach('live-reaction', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(response.ok(), `Live API status: ${result.status}`).toBe(true);
  expect(requests.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
  await expect(page.locator('[data-event="reaction.received"]').first()).toContainText(result.modelOutput || '（空回复）');
  if (result.status === 'replied') {
    expect(isReactionPhrase(result.text)).toBe(true);
    await expect(page.getByTestId('reaction-badge')).toContainText(result.text);
  } else {
    expect(result).toMatchObject({ status: 'skipped', reason: 'none' });
    await expect(page.getByTestId('reaction-badge')).toBeEmpty();
  }
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/reaction-live-browser.png', fullPage: true });
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeEnabled();
});
