import { expect, test } from '@playwright/test';

test('opens home, finds "instructions", waits 5s', async ({ page }) => {
  const url = process.env.BASE_URL ?? 'http://web:5173';
  await page.goto(url);
  await expect(page.getByText('instructions')).toBeVisible();
  await page.waitForTimeout(5000);
});
