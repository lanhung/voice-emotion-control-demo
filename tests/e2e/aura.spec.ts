import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test('renders the orb, emotion previews, help dialog and immersive view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让情绪，自然流动。' })).toBeVisible();
  await expect(page.locator('.orb-canvas canvas')).toBeVisible();
  await expect(page.locator('.connection')).toContainText('本地模型已连接');
  await expect(page.locator('[data-event="visual.applied"]').first()).toBeVisible();
  await page.screenshot({ path: '.artifacts/aura-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '愉悦', exact: true }).click();
  await expect(page.getByRole('img', { name: '愉悦情绪的液态光球' })).toBeVisible();
  await expect(page.locator('.preview-hint')).toContainText('当前为灯效预览');
  await page.getByRole('button', { name: '愤怒', exact: true }).click();
  await expect(page.getByRole('img', { name: '愤怒情绪的液态光球' })).toBeVisible();
  await page.getByRole('button', { name: '进入沉浸模式' }).click();
  await expect(page.locator('.app')).toHaveClass(/is-immersive/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveClass(/is-immersive/);
  await page.getByRole('button', { name: '了解 Aura' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭介绍' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('real AudioWorklet → Node → SenseVoice produces live text and stops cleanly', async ({ page, request }) => {
  test.skip(!existsSync(process.env.TEST_AUDIO_PATH ?? '.artifacts/speech.wav'), 'Provide a real 16 kHz mono WAV via TEST_AUDIO_PATH.');
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  await page.goto('/');
  const submissions: Array<{ size: number; time: number }> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/analyze')) submissions.push({ size: request.postDataBuffer()?.length ?? 0, time: Date.now() });
  });
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
  await expect(page.locator('.transcript-entry').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.entry-content').first()).not.toBeEmpty();
  await expect(page.locator('[data-event="mic.ready"]')).toHaveCount(1);
  await expect(page.locator('[data-event="audio.window"]').first()).toHaveCount(1);
  await expect(page.getByTestId('raw-tags')).toContainText('<|NEUTRAL|>');
  await expect(page.getByTestId('model-emotion-tag')).toHaveText('NEUTRAL');
  await expect.poll(() => submissions.length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  expect(submissions[0].size).toBe(80044);
  const interval = submissions[1].time - submissions[0].time;
  expect(interval).toBeGreaterThan(2000); expect(interval).toBeLessThan(4000);
  await page.screenshot({ path: '.artifacts/aura-listening.png', fullPage: true });
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.error-banner')).toHaveCount(0);
  const countAfterStop = submissions.length;
  await page.waitForTimeout(2800);
  expect(submissions.length).toBe(countAfterStop);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载转写记录' }).click();
  expect((await download).suggestedFilename()).toMatch(/^aura-.*\.txt$/);
  await page.getByRole('button', { name: '清空转写记录' }).click();
  await expect(page.locator('.transcript-entry')).toHaveCount(0);
  const logDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出监控日志' }).click();
  expect((await logDownload).suggestedFilename()).toMatch(/^aura-monitor-.*\.json$/);
});

test('shows microphone denial instead of invented results', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('麦克风权限未开启');
  await expect(page.locator('.transcript-entry')).toHaveCount(0);
});

test('offline inference stops recording and lets the user retry', async ({ page }) => {
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '本地语音模型暂时不可用，请稍后重试。' }) }));
  await page.goto('/');
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本地语音模型暂时不可用', { timeout: 15000 });
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
  await expect(page.locator('.transcript-entry')).toHaveCount(0);
});

test('mobile layout fits the viewport and retains the recording controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeInViewport();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await page.getByRole('button', { name: '惊讶', exact: true }).click();
  await expect(page.getByRole('img', { name: '惊讶情绪的液态光球' })).toBeVisible();
  await page.screenshot({ path: '.artifacts/aura-mobile.png', fullPage: true });
});

test('all seven emotion palettes reach the WebGL material and log their applied color', async ({ page }) => {
  const colors = [ ['平静', '#08B5B8'], ['愉悦', '#FF9F00'], ['低落', '#235BFF'], ['愤怒', '#F51E3B'],
    ['惊讶', '#F529C0'], ['紧张', '#7735EF'], ['厌恶', '#50AD13'] ];
  await page.goto('/');
  for (const [emotion, color] of colors) {
    await page.getByRole('button', { name: emotion, exact: true }).click();
    const entry = page.locator('[data-event="visual.applied"]').filter({ hasText: color }).last();
    await expect(entry).toBeVisible();
    await page.locator('.orb-canvas').screenshot({ path: `.artifacts/orb-${color.slice(1)}.png` });
    await entry.locator('summary').click();
    await expect(entry.locator('pre')).toContainText('"renderer": "webgl"');
  }
});

test('silence filtering is adjustable and every skipped window is observable', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/analyze', (route) => { submissions++; return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"test stop"}' }); });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const real = await original(constraints); real.getTracks().forEach((track) => track.stop());
      const context = new AudioContext();
      const oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = 0;
      const destination = context.createMediaStreamDestination(); oscillator.connect(gain).connect(destination); oscillator.start();
      destination.stream.getTracks()[0].addEventListener('ended', () => { void context.close(); });
      return destination.stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('[data-event="audio.skipped"]').first()).toHaveCount(1, { timeout: 12000 });
  expect(submissions).toBe(0);
  await page.getByRole('checkbox', { name: '跳过静音', exact: true }).uncheck();
  await expect.poll(() => submissions, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
});
