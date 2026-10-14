import { expect, test } from '@playwright/test';

test('switches between orb and matrix while preserving emotion and applying rendered colors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const orbButton = page.getByRole('button', { name: '液态光球', exact: true });
  const matrixButton = page.getByRole('button', { name: '灯光矩阵 8 × 64', exact: true });
  await expect(orbButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '愉悦', exact: true }).click();
  await matrixButton.click();
  await expect(matrixButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.orb-canvas')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '愉悦情绪的 8 行 64 列灯光矩阵' })).toBeVisible();

  for (const [emotion, channel] of [['愉悦', 0], ['低落', 2], ['愤怒', 0]] as const) {
    const previewButton = page.getByRole('button', { name: emotion, exact: true });
    if (await previewButton.getAttribute('aria-pressed') !== 'true') await previewButton.click();
    await expect(page.locator('.render-color')).toContainText('矩阵 灯效已应用');
    // Check actual canvas pixels, so a label/log update alone cannot pass this assertion.
    await expect.poll(async () => page.locator('.matrix-frame canvas').evaluate((element, dominant) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const totals = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        for (let component = 0; component < 3; component++) totals[component] += pixels[index + component] * pixels[index + 3];
      }
      return totals[dominant] > totals[(dominant + 1) % 3] * 1.3 && totals[dominant] > totals[(dominant + 2) % 3] * 1.3;
    }, channel)).toBe(true);
  }
  await page.locator('.experience').screenshot({ path: '.artifacts/matrix-desktop.png' });
  await orbButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: '愤怒情绪的液态光球' })).toBeVisible();
  await expect(page.locator('.light-matrix')).toHaveCount(0);
  await expect(page.locator('.render-color')).toContainText('WebGL 灯效已应用');
  expect(errors).toEqual([]);
});

test('matrix fits mobile and immersive views and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '灯光矩阵 8 × 64', exact: true }).click();
  const canvas = page.locator('.matrix-frame canvas');
  await expect(page.locator('.render-color')).toContainText('矩阵 灯效已应用');
  const bounds = await canvas.boundingBox();
  expect(bounds!.width / bounds!.height).toBeCloseTo(8, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeInViewport();
  const still = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(300);
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(still);
  await page.getByRole('button', { name: '惊讶', exact: true }).click();
  await expect(page.getByRole('img', { name: '惊讶情绪的 8 行 64 列灯光矩阵' })).toBeVisible();
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(still);
  await page.screenshot({ path: '.artifacts/matrix-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '进入沉浸模式' }).click();
  await expect(canvas).toBeInViewport();
  await expect(page.getByRole('button', { name: '液态光球', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.artifacts/matrix-immersive-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveClass(/is-immersive/);
});

test('switching visualizations keeps the active microphone and transcript session', async ({ page }) => {
  await page.route('**/api/analyze', (route) => route.fulfill({ json: {
    text: '灯光矩阵切换测试', emotion: 'happy', language: 'zh', events: [], isSpeech: true,
    latencyMs: 10, durationMs: 2500, tags: ['zh', 'HAPPY', 'Speech'], emotionTag: 'HAPPY',
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry').first()).toBeVisible({ timeout: 15000 });
  const entriesBefore = await page.locator('.transcript-entry').count();
  await page.getByRole('button', { name: '灯光矩阵 8 × 64', exact: true }).click();
  await expect(page.getByRole('img', { name: '愉悦情绪的 8 行 64 列灯光矩阵' })).toBeVisible();
  await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.transcript-entry').count(), { timeout: 10000 }).toBeGreaterThan(entriesBefore);
  await page.getByRole('button', { name: '液态光球', exact: true }).click();
  await expect(page.getByRole('img', { name: '愉悦情绪的液态光球' })).toBeVisible();
  await expect(page.locator('[data-event="mic.ready"]')).toHaveCount(1);
  await expect(page.locator('[data-event="session.started"]')).toHaveCount(1);
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
