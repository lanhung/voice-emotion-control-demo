import { expect, test } from '@playwright/test';

test('recognition settings reach every audio window, stay locked during capture and apply on restart', async ({ page }) => {
  const submissions: Array<{ bytes: number; language: string; banUnknown: string }> = [];
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ready', model: 'SenseVoiceSmall', intervalMs: 2500 } }));
  // Capture uses the real AudioWorklet; only the model response is controlled in this test.
  await page.route('**/api/analyze', (route) => {
    const request = route.request();
    const headers = request.headers();
    const bytes = request.postDataBuffer()!.length;
    submissions.push({ bytes, language: headers['x-aura-language'], banUnknown: headers['x-aura-ban-emo-unk'] });
    const banUnknownEmotion = headers['x-aura-ban-emo-unk'] === 'true';
    return route.fulfill({ json: { text: '用于检查参数传递的测试结果。', emotion: banUnknownEmotion ? 'happy' : 'unknown',
      emotionTag: banUnknownEmotion ? 'HAPPY' : 'EMO_UNKNOWN', tags: ['zh', banUnknownEmotion ? 'HAPPY' : 'EMO_UNKNOWN', 'Speech'],
      isSpeech: true, language: 'zh', events: [], durationMs: (bytes - 44) / 32, latencyMs: 1,
      recognitionOptions: { language: headers['x-aura-language'], banUnknownEmotion } } });
  });
  await page.goto('/');
  const duration = page.getByRole('combobox', { name: '分段时长' });
  const language = page.getByRole('combobox', { name: '识别语言' });
  const allowUnknown = page.getByRole('checkbox', { name: '允许待辨识' });
  await expect(duration).toHaveValue('2500');
  await expect(language).toHaveValue('auto');
  await expect(allowUnknown).not.toBeChecked();
  await page.getByRole('checkbox', { name: '跳过静音', exact: true }).uncheck();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  for (const control of [duration, language, allowUnknown]) await expect(control).toBeDisabled();
  await expect.poll(() => submissions.length, { timeout: 12000 }).toBeGreaterThan(0);
  expect(submissions[0]).toEqual({ bytes: 80044, language: 'auto', banUnknown: 'true' });
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(duration).toBeEnabled();
  expect(submissions.every((item) => item.language === 'auto' && item.banUnknown === 'true')).toBe(true);

  const secondRound = submissions.length;
  await duration.selectOption('5000');
  await language.selectOption('zh');
  await allowUnknown.check();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.monitor-stages')).toContainText('5 秒分段');
  await expect.poll(() => submissions.length, { timeout: 12000 }).toBeGreaterThan(secondRound);
  expect(submissions[secondRound]).toEqual({ bytes: 160044, language: 'zh', banUnknown: 'false' });
  await expect(page.getByTestId('model-emotion-tag')).toHaveText('EMO_UNKNOWN');
  // Leave a partial final window to verify that flushing keeps the same options.
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(duration).toBeEnabled();
  expect(submissions.length).toBeGreaterThan(secondRound + 1);
  expect(submissions.at(-1)!.bytes).toBeGreaterThanOrEqual(3244);
  expect(submissions.at(-1)!.bytes).toBeLessThan(160044);
  expect(submissions.slice(secondRound).every((item) => item.language === 'zh' && item.banUnknown === 'false')).toBe(true);
  const lastResult = page.locator('[data-event="recognition.result"]').last();
  await lastResult.locator('summary').click();
  await expect(lastResult.locator('pre')).toContainText('"banUnknownEmotion": false');
  await expect(lastResult.locator('pre')).toContainText('"language": "zh"');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.monitor-panel').screenshot({ path: '.artifacts/recognition-settings-mobile.png' });
});
