import { expect, test } from '@playwright/test';

test('spins to the chosen answer, preserves history on cancelled refresh, and clears on confirmed refresh', async ({ page }) => {
  await page.route('**/api/spin', (route) => route.fulfill({ json: { index: 2, answer: 'Maybe' } }));
  await page.goto('/');
  await page.getByLabel("What's on your mind?").fill('Should I take a break?');
  await page.getByRole('button', { name: 'Spin the wheel' }).click();
  await expect(page.getByRole('button', { name: 'Spinning...' })).toBeDisabled();
  await expect(page.locator('.history-entry')).toHaveCount(0);
  await expect(page.locator('#result-text')).toHaveText('Maybe', { timeout: 8000 });
  await expect(page.locator('.history-entry')).toContainText('Should I take a break?');
  await expect(page.locator('.answer-badge')).toHaveText('Maybe');
  const rotation = await page.locator('#wheel').evaluate((wheel) => {
    const matrix = new DOMMatrix(getComputedStyle(wheel).transform);
    return (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;
  });
  expect(rotation).toBeCloseTo(180, 0);

  const pendingDialog = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
  const dialog = await pendingDialog;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.locator('.history-entry')).toHaveCount(1);

  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator('.history-entry')).toHaveCount(0);
  await expect(page.getByText('A fresh start')).toBeVisible();
});

test('keeps questions as text, handles repeated spins, and puts the newest entry first', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/spin', (route) => route.fulfill({ json: { index: 0, answer: 'Yes' } }));
  await page.goto('/');
  for (const question of ['<img src=x onerror=alert(1)>', 'Try again?']) {
    await page.getByLabel("What's on your mind?").fill(question);
    await page.getByRole('button', { name: 'Spin the wheel' }).click();
    await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeEnabled();
  }
  await expect(page.locator('.history-entry')).toHaveCount(2);
  await expect(page.locator('.history-question').first()).toHaveText('Try again?');
  await expect(page.locator('.history-question').last()).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.history-entry img')).toHaveCount(0);
});

test('rejects whitespace and recovers after a network error without adding history', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("What's on your mind?").fill('   ');
  await page.getByRole('button', { name: 'Spin the wheel' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a question');
  await page.route('**/api/spin', (route) => route.abort());
  await page.getByLabel("What's on your mind?").fill('Will this work?');
  await page.getByRole('button', { name: 'Spin the wheel' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not reach the wheel');
  await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeEnabled();
  await expect(page.locator('.history-entry')).toHaveCount(0);
  await expect(page.getByLabel("What's on your mind?")).toHaveValue('Will this work?');
});

for (const width of [320, 360]) {
  test(`fits a ${width}px screen without horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeVisible();
  });
}
