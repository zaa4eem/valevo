import { test, expect } from '@playwright/test';

/**
 * Smoke test for User Story 3 (specs/001-zaa4eem-platform/spec.md).
 * Requires the full stack running locally per quickstart.md.
 */
test.describe('Feed & profiles (US3)', () => {
  test('a logged-out visitor can read the home feed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ZAA4EEM' })).toBeVisible();
    await expect(page.getByText('комьюнити · стримы · squad')).toBeVisible();
  });

  test('a visitor can open any user’s public profile', async ({ page, request }) => {
    const apiBase = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
    const email = `profile-e2e-${Date.now()}@test.dev`;
    const res = await request.post(`${apiBase}/auth/register`, {
      data: { email, password: 'password123', displayName: 'Profile E2E' },
    });
    const body = await res.json();

    await page.goto(`/u/${body.user.id}`);
    await expect(page.getByRole('heading', { name: 'Profile E2E' })).toBeVisible();
    await expect(page.getByText('Идей предложено')).toBeVisible();
  });
});
