import { expect, test, type Page } from "@playwright/test";

const PW = "demo-password-2026";
const shots = "docs/screenshots";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

test("main path through the UI: post → apply → message → offer → accept → fund → deliver → approve → release", async ({ page }) => {
  const title = `E2E dashboard build ${Date.now()}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("milestone");
  await page.screenshot({ path: `${shots}/01-landing.png`, fullPage: true });

  // Client posts and publishes a job
  await signIn(page, "client-olive@demo.workspring.test");
  await page.goto("/app/jobs/new");
  await page.getByLabel("Job title").fill(title);
  await page.getByLabel("Category").selectOption("web-mobile-dev");
  await page.getByLabel("Description, deliverables and success criteria").fill("Build a React dashboard backed by PostgreSQL with filters, CSV export, tests and a short handover document.");
  await page.getByLabel("React", { exact: true }).check();
  await page.getByLabel("PostgreSQL", { exact: true }).check();
  await page.getByLabel("Budget maximum (or hourly max)").fill("900");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/app\/jobs\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Job is now open.")).toBeVisible();

  // Freelancer finds it and applies
  await signIn(page, "amira@demo.workspring.test");
  await page.goto(`/jobs?q=${encodeURIComponent("E2E dashboard")}`);
  await page.screenshot({ path: `${shots}/02-job-search.png`, fullPage: true });
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("link", { name: "Submit a proposal" }).click();
  await page.getByLabel(/Your fixed bid/).fill("850");
  await page.getByLabel("Cover letter").fill("I have built several React + PostgreSQL dashboards with exports and tests. Happy to start this week.");
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByText("Proposal sent.")).toBeVisible();
  const proposalUrl = page.url();

  // Client messages and sends an offer
  await signIn(page, "client-olive@demo.workspring.test");
  await page.goto(proposalUrl.replace(/\?.*$/, ""));
  await page.getByRole("button", { name: "Message freelancer" }).click();
  await page.waitForURL(/\/app\/messages\//);
  await page.getByRole("textbox", { name: "Message" }).fill("Hi! Could you start on Monday?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Hi! Could you start on Monday?")).toBeVisible();
  await page.goto(proposalUrl.replace(/\?.*$/, ""));
  await page.getByLabel("Scope and deliverables").fill("Dashboard with filters, CSV export, tests and docs.");
  await page.getByRole("button", { name: "Send offer" }).click();
  await page.waitForURL(/\/app\/offers\//);
  const offerUrl = page.url().replace(/\?.*$/, "");

  // Freelancer accepts
  await signIn(page, "amira@demo.workspring.test");
  await page.goto(offerUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Accept offer and start contract" }).click();
  await page.waitForURL(/\/app\/contracts\//);
  const contractUrl = page.url().replace(/\?.*$/, "");

  // Client funds through the simulated provider checkout
  await signIn(page, "client-olive@demo.workspring.test");
  await page.goto(contractUrl);
  await page.getByRole("button", { name: /^Fund .*\(test\)$/ }).click();
  await page.waitForURL(/\/test-provider\/checkout\//);
  await page.getByRole("button", { name: "Simulate: payment succeeded" }).click();
  await page.waitForURL(/webhook=applied/);
  await expect(page.getByText("funded", { exact: true }).first()).toBeVisible();

  // Freelancer delivers
  await signIn(page, "amira@demo.workspring.test");
  await page.goto(contractUrl);
  await page.getByLabel("Delivery note").fill("Dashboard delivered: filters, CSV export and tests are in the repository.");
  await page.getByRole("button", { name: "Submit work" }).click();
  await expect(page.getByText("submitted", { exact: true }).first()).toBeVisible();

  // Client approves; provider confirms transfer
  await signIn(page, "client-olive@demo.workspring.test");
  await page.goto(contractUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve and release payment" }).click();
  await page.getByRole("button", { name: "Simulate provider: transfer succeeded" }).click();
  await page.waitForURL(/webhook=applied/);
  await expect(page.getByText("released", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/03-contract-workroom.png`, fullPage: true });
});
