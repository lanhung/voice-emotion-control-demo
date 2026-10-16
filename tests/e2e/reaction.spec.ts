import { expect, test, type Route } from '@playwright/test';
import type { DisplayedRequest, ReactionRequest } from '../../shared/reaction';
import { prepareReaction, recordReactionRound, replyToDecision } from './reaction-fixture';

for (const mode of ['orb', 'matrix'] as const) {
  test(`${mode}: renders the server phrase, acknowledges once, and preserves its lifetime on mode switch`, async ({ page }) => {
    const requests: ReactionRequest[] = []; const acknowledgements: DisplayedRequest[] = [];
    await page.route('**/api/reaction/decision', (route) => {
      const input = route.request().postDataJSON() as ReactionRequest; requests.push(input);
      return replyToDecision(route, input, requests.length > 1 ? { status: 'skipped', reason: 'global_interval' } : {});
    });
    await page.route('**/api/reaction/displayed', (route) => {
      const input = route.request().postDataJSON() as DisplayedRequest; acknowledgements.push(input);
      return route.fulfill({ json: { status: 'accepted', decisionId: input.decisionId } });
    });
    await prepareReaction(page); await page.emulateMedia({ reducedMotion: 'reduce' });
    if (mode === 'matrix') await page.getByRole('button', { name: /灯光矩阵/ }).click();
    await expect(page.getByRole('checkbox', { name: '短回应' })).not.toBeChecked();
    await expect(page.locator('#reaction-description')).toContainText('本地决策模型和词库');
    await page.getByRole('checkbox', { name: '短回应' }).check();
    await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    await expect(page.getByTestId('reaction-badge')).toContainText("I'm here.");
    await expect.poll(() => acknowledgements.length).toBe(1);
    const paintedAt = Date.now();
    expect(Object.keys(requests[0]).sort()).toEqual(['clientId', 'sessionId', 'generation', 'turnId', 'sequence', 'emotion', 'isSpeech', 'canDisplay'].sort());
    expect(Object.keys(acknowledgements[0]).sort()).toEqual(['clientId', 'sessionId', 'generation', 'decisionId'].sort());
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: mode === 'matrix' ? /液态光球/ : /灯光矩阵/ }).click();
    await expect(page.getByTestId('reaction-badge')).toContainText("I'm here.");
    await expect(page.getByTestId('reaction-badge')).toBeEmpty({ timeout: 2500 });
    expect(Date.now() - paintedAt).toBeLessThan(3400); expect(acknowledgements).toHaveLength(1);
    await expect.poll(() => requests.some((input) => !input.canDisplay)).toBe(true);
    await page.locator('.experience').screenshot({ path: `.artifacts/reaction-animation-gap-${mode}.png` });
    await page.getByRole('button', { name: '结束聆听', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
    const count = requests.length; await page.waitForTimeout(5500); expect(requests).toHaveLength(count);
  });
}

test('does not call the decision API while disabled', async ({ page }) => {
  let calls = 0; await page.route('**/api/reaction/decision', (route) => { calls++; return route.abort(); });
  await prepareReaction(page); await recordReactionRound(page); expect(calls).toBe(0);
});

for (const action of ['new-recording', 'disable', 'clear', 'hidden'] as const) {
  test(`discards a late result after ${action}, even if the transport ignores cancellation`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => original(input, input === '/api/reaction/decision' ? { ...init, signal: undefined } : init);
    });
    let pending: Route | undefined; let acks = 0;
    await page.route('**/api/reaction/decision', (route) => { pending = route; });
    await page.route('**/api/reaction/displayed', (route) => { acks++; return route.abort(); });
    await prepareReaction(page); await page.getByRole('checkbox', { name: '短回应' }).check(); await recordReactionRound(page);
    await expect.poll(() => !!pending).toBe(true); const old = pending!;
    await expect(page.getByTestId('reaction-badge')).toBeEmpty();
    if (action === 'new-recording') await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    if (action === 'disable') await page.getByRole('checkbox', { name: '短回应' }).uncheck();
    if (action === 'clear') await page.getByRole('button', { name: '清空转写记录' }).click();
    if (action === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const received = page.waitForResponse('**/api/reaction/decision');
    await replyToDecision(old, old.request().postDataJSON()); await received; await page.waitForTimeout(200);
    await expect(page.getByTestId('reaction-badge')).toBeEmpty(); expect(acks).toBe(0);
  });
}

test('propagates browser abort on disable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (input === '/api/reaction/decision') init?.signal?.addEventListener('abort', () => { document.documentElement.dataset.reactionAborted = 'true'; });
      return original(input, init);
    };
  });
  await page.route('**/api/reaction/decision', () => undefined);
  await prepareReaction(page); await page.getByRole('checkbox', { name: '短回应' }).check(); await recordReactionRound(page);
  await expect(page.locator('[data-event="reaction.requested"]')).toHaveCount(1);
  await page.getByRole('checkbox', { name: '短回应' }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-reaction-aborted', 'true');
});

for (const outcome of ['skipped', 'invalid', 'timeout'] as const) {
  test(`${outcome} leaves recognition and lights usable`, async ({ page }) => {
    await page.route('**/api/reaction/decision', (route) => replyToDecision(route, route.request().postDataJSON(),
      outcome === 'skipped' ? { status: 'skipped', reason: 'all_on_cooldown' }
        : outcome === 'invalid' ? { text: 'This has too many words' }
          : { status: 'error', code: 'decision_timeout', error: 'timeout' }));
    await prepareReaction(page); await page.getByRole('checkbox', { name: '短回应' }).check();
    await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    if (outcome === 'skipped') {
      await expect(page.locator('[data-event="reaction.skipped"]').first()).toBeVisible();
      await expect(page.getByTestId('reaction-badge')).toBeEmpty();
    }
    else await expect(page.getByTestId('reaction-badge')).toContainText(outcome === 'timeout' ? '超时' : '暂时不可用');
    await expect(page.locator('.reaction-text')).toHaveCount(0); await expect(page.locator('.error-banner')).toHaveCount(0);
    await page.getByRole('button', { name: '结束聆听', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开始聆听', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束聆听', exact: true })).toBeVisible();
  });
}

test('clearing during recognition discards the old generation tail', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route('**/api/reaction/decision', () => { calls++; });
  await prepareReaction(page, gate); await page.getByRole('checkbox', { name: '短回应' }).check();
  await page.getByRole('button', { name: '开始聆听', exact: true }).click();
  await expect(page.locator('.transcript-entry')).toHaveCount(1);
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: '结束聆听', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成识别中', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空转写记录' }).click(); release();
  await expect(page.getByRole('button', { name: '开始聆听', exact: true })).toBeVisible();
  await expect(page.getByTestId('reaction-badge')).toBeEmpty(); expect(calls).toBe(1);
});
