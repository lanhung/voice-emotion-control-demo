import { expect, test, type Page, type Route } from '@playwright/test';
import { REACTION_ANIMATION_GAP_MS, REACTION_DISPLAY_MS, type ReactionRequest } from '../../shared/reaction';

async function prepare(page: Page, finalRecognitionGate?: Promise<void>) {
  const transcripts: string[] = [];
  const audioSizes: number[] = [];
  await page.route('**/api/analyze', async (route) => {
    const text = transcripts.length ? '最后，我没有考上。' : '我一直在准备考试，';
    transcripts.push(text); audioSizes.push(route.request().postDataBuffer()!.length);
    // The tail must be included even if recognition arrives after Stop was clicked.
    if (transcripts.length > 1 && finalRecognitionGate) await finalRecognitionGate;
    await route.fulfill({ json: { text, emotion: 'happy', isSpeech: true, language: 'zh', events: [],
      tags: ['zh', 'HAPPY', 'Speech'], emotionTag: 'HAPPY', latencyMs: 12, durationMs: 2500 } });
  });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '跳过静音', exact: true }).uncheck();
  return { transcripts, audioSizes };
}

async function recordRound(page: Page) {
  const before = await page.locator('[data-event="recognition.result"]').count();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('[data-event="recognition.result"]')).toHaveCount(before + 1, { timeout: 10000 });
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
}

const reply = (route: Route, input: ReactionRequest, extra: Record<string, unknown> = {}) => route.fulfill({
  json: { sessionId: input.sessionId, turnId: input.turnId, requestId: 'test', latencyMs: 15, status: 'replied', text: "I'm here.", ...extra },
});

interface DisplayChange { showing: boolean; at: number }
async function observeReplyDisplay(page: Page) {
  const changes: DisplayChange[] = [];
  await page.exposeFunction('recordReplyDisplay', (change: DisplayChange) => { changes.push(change); });
  await page.evaluate(() => {
    const stage = document.querySelector('.orb-stage')!;
    const report = (window as unknown as { recordReplyDisplay: (change: DisplayChange) => Promise<void> }).recordReplyDisplay;
    let showing = stage.classList.contains('has-reaction');
    new MutationObserver(() => {
      const next = stage.classList.contains('has-reaction');
      if (next !== showing) { showing = next; void report({ showing, at: performance.now() }); }
    }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  });
  return changes;
}

test('is opt-in, handles an unsent tail after a slow reply, and expires from arrival', async ({ page }) => {
  const { transcripts, audioSizes } = await prepare(page);
  const requests: ReactionRequest[] = [];
  let pending: Route | undefined;
  await page.route('**/api/reaction', (route) => { requests.push(route.request().postDataJSON() as ReactionRequest); pending = route; });
  await expect(page.getByRole('checkbox', { name: '短回应' })).not.toBeChecked();
  await expect(page.locator('#reaction-description')).toContainText('是否传至云端取决于代理配置');
  await page.getByRole('checkbox', { name: '短回应' }).check();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry')).toHaveCount(1);
  await expect.poll(() => requests.length).toBe(1);
  const firstRoute = pending!;
  await page.waitForTimeout(150); // Keep a valid >=100 ms tail.
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
  await expect(page.getByTestId('reaction-badge')).toBeHidden();
  await page.screenshot({ path: '.artifacts/reaction-silent-waiting.png', fullPage: true });
  expect(requests).toHaveLength(1);
  expect(transcripts.length).toBeGreaterThanOrEqual(2);
  expect(requests[0].text).toBe(transcripts[0]);
  expect(audioSizes.at(-1)).toBeLessThan(80044);
  await page.waitForTimeout(REACTION_DISPLAY_MS + 300); // Display lifetime must start with the response, not the request.
  await expect(page.getByTestId('reaction-badge')).toBeHidden();
  await reply(firstRoute, requests[0]);
  await expect(page.getByTestId('reaction-badge')).toContainText("I'm here.");
  await expect(page.getByTestId('liquid-reply')).toHaveAttribute('data-morph', 'text');
  await expect(page.getByRole('img', { name: "液态光球回应：I'm here." })).toBeVisible();
  await page.getByRole('button', { name: /灯光矩阵/ }).click();
  await page.getByRole('button', { name: '进入沉浸模式' }).click();
  await expect(page.getByRole('img', { name: "灯光矩阵回应：I'm here." })).toBeVisible();
  await expect(page.getByTestId('liquid-reply')).toHaveCount(0);
  await expect(page.getByTestId('reaction-badge')).toContainText("I'm here.");
  await expect(page.getByTestId('reaction-badge')).toBeEmpty({ timeout: 5000 });
  await expect(page.getByRole('img', { name: '愉悦情绪的 8 行 64 列灯光矩阵' })).toBeVisible();
  await expect(page.locator('.matrix-frame canvas')).not.toHaveAttribute('data-text');
  expect(requests).toHaveLength(1);
  await expect.poll(() => requests.length, { timeout: REACTION_ANIMATION_GAP_MS + 2000 }).toBe(2);
  expect(requests[1].text).toBe(transcripts.join('\n'));
  await reply(pending!, requests[1], { status: 'skipped', text: undefined, reason: 'none', modelOutput: 'NONE' });
  await expect(page.getByTestId('reaction-badge')).toBeHidden();
  expect(requests).toHaveLength(2);
});

for (const mode of ['orb', 'matrix'] as const) {
  test(`keeps ${mode} animation between logged replies while continuing recognition`, async ({ page }) => {
    await prepare(page);
    if (mode === 'matrix') await page.getByRole('button', { name: /灯光矩阵/ }).click();
    const displays = await observeReplyDisplay(page);
    const requests: { input: ReactionRequest; at: number }[] = [];
    await page.route('**/api/reaction', (route) => {
      const input = route.request().postDataJSON() as ReactionRequest;
      requests.push({ input, at: Date.now() });
      const text = requests.length === 1 ? "I'm here." : "That's rough.";
      return reply(route, input, { text, modelOutput: text, finishReason: 'stop' });
    });
    await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    // Enabling during an active recording takes effect on its next recognition.
    await page.getByRole('checkbox', { name: '短回应' }).check();
    await expect(page.getByTestId('reaction-badge')).toContainText("I'm here.", { timeout: 10000 });
    await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: `${mode === 'orb' ? '液态光球' : '灯光矩阵'}回应：I'm here.` })).toBeVisible();
    await expect(page.locator('[data-event="reaction.received"] summary')).toContainText("大模型回复：I'm here.");
    await page.getByRole('combobox', { name: '日志筛选' }).selectOption('reaction');
    await page.locator('[data-event="reaction.received"] summary').click();
    await expect(page.locator('[data-event="reaction.received"] pre')).toContainText('modelOutput');
    if (mode === 'orb') await expect(page.getByTestId('liquid-reply')).toHaveAttribute('data-morph', 'text');
    await expect(page.locator('.render-color')).toContainText('短回应文字已显示');
    await expect(page.getByTestId('reaction-badge')).toBeHidden({ timeout: 5000 });
    const animation = page.getByRole('img', { name: mode === 'orb' ? '愉悦情绪的液态光球' : '愉悦情绪的 8 行 64 列灯光矩阵' });
    await expect(animation).toBeVisible();
    const recognized = await page.locator('.transcript-entry').count();
    expect(requests).toHaveLength(1);
    await page.locator('.experience').screenshot({ path: `.artifacts/reaction-animation-gap-${mode}.png` });
    await expect(page.getByTestId('reaction-badge')).toContainText("That's rough.", { timeout: REACTION_ANIMATION_GAP_MS + 3000 });
    await expect.poll(() => displays.length).toBeGreaterThanOrEqual(3);
    expect(displays.slice(0, 3).map((change) => change.showing)).toEqual([true, false, true]);
    expect(displays[1].at - displays[0].at).toBeGreaterThanOrEqual(REACTION_DISPLAY_MS - 100);
    expect(displays[1].at - displays[0].at).toBeLessThanOrEqual(3000);
    expect(displays[2].at - displays[1].at).toBeGreaterThanOrEqual(REACTION_ANIMATION_GAP_MS - 100);
    expect(await page.locator('.transcript-entry').count()).toBeGreaterThan(recognized);
    await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
    expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(REACTION_DISPLAY_MS + REACTION_ANIMATION_GAP_MS - 100);
    expect(requests[1].input.text).toContain('最后，我没有考上。');
    expect(requests[1].input.text.split('\n').length).toBeGreaterThan(1);
    expect(requests[1].input.text.split('\n').length).toBeLessThanOrEqual(6);
    expect(requests[1].input.turnId).not.toBe(requests[0].input.turnId);
    await expect(page.locator('[data-event="visual.fallback"]')).toHaveCount(0);
    await page.getByRole('checkbox', { name: '短回应' }).uncheck();
    await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  });
}

test('never calls the reaction API when disabled', async ({ page }) => {
  await prepare(page);
  let calls = 0;
  await page.route('**/api/reaction', (route) => { calls++; return route.abort(); });
  await recordRound(page);
  expect(calls).toBe(0);
});

for (const action of ['new-recording', 'disable', 'clear'] as const) {
  test(`discards a late result after ${action} even if transport ignores cancellation`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => original(input, input === '/api/reaction' ? { ...init, signal: undefined } : init);
    });
    await prepare(page);
    let pending: Route | undefined;
    await page.route('**/api/reaction', (route) => { pending = route; });
    await page.getByRole('checkbox', { name: '短回应' }).check();
    await recordRound(page);
    await expect.poll(() => pending !== undefined).toBe(true);
    await expect(page.getByTestId('reaction-badge')).toBeHidden();
    const old = pending!;
    if (action === 'new-recording') await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    if (action === 'disable') await page.getByRole('checkbox', { name: '短回应' }).uncheck();
    if (action === 'clear') await page.getByRole('button', { name: '清空转写记录' }).click();
    await expect(page.getByTestId('reaction-badge')).toBeEmpty();
    const received = page.waitForResponse('**/api/reaction');
    await reply(old, old.request().postDataJSON() as ReactionRequest, { text: 'Congrats!' });
    await received;
    await page.waitForTimeout(200);
    await expect(page.getByTestId('reaction-badge')).toBeEmpty();
    if (action === 'new-recording') {
      await page.getByRole('checkbox', { name: '短回应' }).uncheck();
      await page.getByRole('button', { name: '结束聆听', exact: true }).click();
    }
  });
}

test('aborts the browser request when short reactions are switched off', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (input === '/api/reaction') init?.signal?.addEventListener('abort', () => { document.documentElement.dataset.reactionAborted = 'true'; });
      return original(input, init);
    };
  });
  await prepare(page);
  await page.route('**/api/reaction', () => undefined);
  await page.getByRole('checkbox', { name: '短回应' }).check();
  await recordRound(page);
  await expect(page.locator('[data-event="reaction.requested"]')).toHaveCount(1);
  await expect(page.getByTestId('reaction-badge')).toBeHidden();
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-reaction-aborted', 'true');
});

for (const outcome of ['none', 'invalid', 'timeout'] as const) {
  test(`${outcome} does not show a phrase or block the next recording`, async ({ page }) => {
    await prepare(page);
    await page.route('**/api/reaction', (route) => reply(route, route.request().postDataJSON() as ReactionRequest,
      outcome === 'none' ? { status: 'skipped', reason: 'none', text: undefined }
        : outcome === 'invalid' ? { text: 'This is a long answer' }
          : { status: 'error', code: 'timeout', error: 'timeout' }));
    await page.getByRole('checkbox', { name: '短回应' }).check();
    await recordRound(page);
    if (outcome === 'none') {
      await expect(page.locator('[data-event="reaction.skipped"]')).toHaveCount(1);
      await expect(page.getByTestId('reaction-badge')).toBeEmpty();
    } else await expect(page.getByTestId('reaction-badge')).toContainText(outcome === 'timeout' ? '超时' : '暂时不可用');
    await expect(page.locator('.reaction-text')).toHaveCount(0);
    await expect(page.locator('.error-banner')).toHaveCount(0);
    await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: '短回应' }).uncheck();
    await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  });
}

test('clearing during final recognition cancels the previous response and suppresses the tail', async ({ page }) => {
  let releaseFinalRecognition!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFinalRecognition = resolve; });
  const { transcripts } = await prepare(page, gate);
  let calls = 0;
  await page.route('**/api/reaction', () => { calls++; });
  await page.getByRole('checkbox', { name: '短回应' }).check();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry')).toHaveCount(1);
  await expect.poll(() => transcripts.length).toBeGreaterThan(1);
  expect(calls).toBe(1);
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成识别中', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空转写记录' }).click();
  releaseFinalRecognition();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
  await expect(page.getByTestId('reaction-badge')).toBeEmpty();
  await page.waitForTimeout(450);
  expect(calls).toBe(1);
});
