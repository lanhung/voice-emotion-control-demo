import { expect, test, type Page } from '@playwright/test';
import type { ReactionPhrase } from '../../shared/reaction';
import { layoutMatrixText } from '../../src/visualization/matrixText';
import { replyToDecision } from './reaction-fixture';

async function showReply(page: Page, text: ReactionPhrase, matrix = false) {
  await page.route('**/api/analyze', (route) => route.fulfill({ json: {
    text: '我准备好了。', emotion: 'neutral', isSpeech: true, language: 'zh', events: [],
    tags: ['zh', 'NEUTRAL', 'Speech'], emotionTag: 'NEUTRAL', latencyMs: 10, durationMs: 2500,
  } }));
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ready', model: 'SenseVoiceSmall', intervalMs: 2500 } }));
  await page.route('**/api/reaction/decision', (route) => replyToDecision(route, route.request().postDataJSON(), { text }));
  await page.route('**/api/reaction/displayed', (route) => route.fulfill({ json: { status: 'accepted', decisionId: route.request().postDataJSON().decisionId } }));
  await page.goto('/');
  if (matrix) await page.getByRole('button', { name: /灯光矩阵/ }).click();
  await page.getByRole('checkbox', { name: '跳过静音', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '短回应' }).check();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry').first()).toBeVisible();
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByTestId('reaction-badge')).toContainText(text);
  await expect(page.locator('.render-color')).toContainText('短回应文字已显示');
}

test('the longest reply is rendered by the actual 512 LEDs on mobile and resets for a new recording', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await showReply(page, 'I understand.', true);
  const canvas = page.locator('.matrix-frame canvas');
  // Compare actual light centers with the layout, rather than trusting labels.
  const lights = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    return Array.from({ length: 512 }, (_, index) => {
      const x = Math.floor(((index % 64) + 0.5) * canvas.width / 64);
      const y = Math.floor((Math.floor(index / 64) + 0.5) * canvas.height / 8);
      return context.getImageData(x, y, 1, 1).data[3] > 180 ? 1 : 0;
    });
  });
  expect(lights).toEqual([...layoutMatrixText('I understand.').pixels]);
  const still = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(200);
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(still);
  await page.getByRole('button', { name: '进入沉浸模式' }).click();
  await expect(canvas).toBeInViewport();
  await page.screenshot({ path: '.artifacts/reaction-matrix-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('data-text');
  await expect(page.getByRole('img', { name: '平静情绪的 8 行 64 列灯光矩阵' })).toBeVisible();
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
});

test('liquid words remain readable without WebGL, respect reduced motion and clear immediately when disabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
      if (contextId.includes('webgl')) return null;
      return Reflect.apply(original, this, [contextId, ...args]);
    } as typeof original;
  });
  await showReply(page, 'I understand.');
  const canvas = page.getByTestId('liquid-reply');
  await expect(canvas).toHaveAttribute('data-morph', 'text');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const shape = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width; let right = 0; let top = canvas.height; let bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 220) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { left, right, width: canvas.width, ratio: (right - left) / (bottom - top) };
  });
  expect(shape.left).toBeGreaterThan(0);
  expect(shape.right).toBeLessThan(shape.width);
  expect(shape.ratio).toBeGreaterThan(4); // Letters occupy a wide line, not the original round orb.
  const still = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(200);
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(still);
  await page.screenshot({ path: '.artifacts/reaction-orb-mobile.png', fullPage: true });
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await expect(canvas).toHaveCount(0);
  await expect(page.getByRole('img', { name: '平静情绪的液态光球' })).toBeVisible();
  await expect(page.locator('.orb-surface')).toHaveCSS('opacity', '1');
  await expect(page.locator('.fallback-orb')).toBeVisible();
});

test('animated liquid replies acknowledge the first visible frame and finish within one display lifetime', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const receipts: string[] = [];
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ready', model: 'SenseVoiceSmall', intervalMs: 2500 } }));
  await page.route('**/api/analyze', (route) => route.fulfill({ json: {
    text: '准备好了。', emotion: 'happy', isSpeech: true, language: 'zh', events: [], tags: [], emotionTag: 'HAPPY', latencyMs: 1, durationMs: 2500,
  } }));
  let decisions = 0;
  await page.route('**/api/reaction/decision', (route) => replyToDecision(route, route.request().postDataJSON(),
    ++decisions === 1 ? { text: 'Awesome!' } : { status: 'skipped', reason: 'global_interval' }));
  await page.route('**/api/reaction/displayed', (route) => {
    const id = route.request().postDataJSON().decisionId; receipts.push(id);
    return route.fulfill({ json: { status: 'accepted', decisionId: id } });
  });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '跳过静音', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '短回应' }).check();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.getByTestId('liquid-reply')).toHaveAttribute('data-morph', 'forming');
  await expect.poll(() => receipts.length).toBe(1);
  const paintedAt = Date.now();
  await expect(page.getByTestId('liquid-reply')).toHaveAttribute('data-morph', 'text');
  await page.getByTestId('liquid-reply').screenshot({ path: '.artifacts/reaction-orb-animated.png' });
  await expect(page.getByTestId('liquid-reply')).toHaveCount(0, { timeout: 3000 });
  expect(Date.now() - paintedAt).toBeLessThan(3300); expect(receipts).toHaveLength(1);
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
});
