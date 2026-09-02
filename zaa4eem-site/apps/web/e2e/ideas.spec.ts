import { test, expect } from '@playwright/test';

/**
 * Smoke test for User Story 1 (specs/001-zaa4eem-platform/spec.md).
 * Requires the full stack running locally (web + api + postgres) per
 * quickstart.md — not runnable against a static build alone.
 */
test.describe('Ideas board (US1)', () => {
  test('a registered user can submit an idea and see it on the board', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.dev`;

    await page.goto('/login');
    await page.getByText('Нет аккаунта? Зарегистрироваться').click();
    await page.getByPlaceholder('Имя').fill('E2E Tester');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Пароль').fill('password123');
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

    await page.waitForURL('/');

    await page.goto('/ideas/new');
    const title = `Add feature ${Date.now()}`;
    await page.getByPlaceholder(/тёмная тема/).fill(title);
    await page
      .getByPlaceholder(/Расскажи подробнее/)
      .fill('This is a detailed enough description for the e2e test.');
    await page.getByRole('button', { name: 'Отправить идею' }).click();

    await expect(page.getByText(title)).toBeVisible();

    await page.goto('/ideas');
    await expect(page.getByText(title)).toBeVisible();
  });
});
