import type { Cookie, Page } from "@playwright/test";

export const PW = "demo-password-2026";

// One real sign-in per account per worker; later switches reuse that account's session cookie.
// This keeps the suite under the production login rate limits (8 per account / 30 per IP per 10 minutes).
const sessions = new Map<string, Cookie[]>();

export async function signIn(page: Page, email: string) {
  const ctx = page.context();
  await ctx.clearCookies();
  const saved = sessions.get(email);
  if (saved) {
    await ctx.addCookies(saved);
    await page.goto("/app");
    if (!/\/signin/.test(page.url())) return;
    sessions.delete(email);
    await ctx.clearCookies();
  }
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
  sessions.set(email, await ctx.cookies());
}
