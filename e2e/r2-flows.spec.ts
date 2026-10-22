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
const clean = (u: string) => u.replace(/\?.*$/, "");

test("services: browse → tier checkout → provider webhook → requirements → deliver → approve → completed", async ({ page }) => {
  await page.goto("/services?q=landing");
  await expect(page.getByRole("link", { name: "Responsive landing page in Next.js with tests" })).toBeVisible();
  await page.screenshot({ path: `${shots}/04-services.png`, fullPage: true });

  await signIn(page, "client-atlas@demo.workspring.test");
  await page.goto("/services?q=landing");
  await page.getByRole("link", { name: "Responsive landing page in Next.js with tests" }).click();
  await page.getByTestId("tier-starter").check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL(/\/test-provider\/checkout\//);
  await page.getByRole("button", { name: "Simulate: payment succeeded" }).click();
  await page.waitForURL(/\/app\/orders\/.*webhook=applied/);
  const orderUrl = clean(page.url());
  await page.getByLabel(/brand assets/).fill("https://example.test/atlas-brand");
  await page.getByLabel(/target audience/).fill("Warehouse managers evaluating robots");
  await page.getByRole("button", { name: "Submit requirements and start order" }).click();
  await expect(page.getByText("Requirements submitted. The delivery clock has started.")).toBeVisible();

  await signIn(page, "amira@demo.workspring.test");
  await page.goto(orderUrl);
  await page.getByLabel("Delivery note").fill("Hero section delivered with a call to action and tests.");
  await page.getByRole("button", { name: "Send delivery" }).click();
  await expect(page.getByText("Delivery sent.")).toBeVisible();

  await signIn(page, "client-atlas@demo.workspring.test");
  await page.goto(orderUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve and release payment" }).click();
  await page.getByRole("button", { name: "Simulate provider: transfer succeeded" }).click();
  await page.waitForURL(/webhook=applied/);
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
});

test("hourly: hire hourly → manual time → submit timesheet → client approves → provider pays", async ({ page }) => {
  const title = `E2E hourly support ${Date.now()}`;
  await signIn(page, "client-atlas@demo.workspring.test");
  await page.goto("/app/jobs/new");
  await page.getByLabel("Job title").fill(title);
  await page.getByLabel("Category").selectOption("web-mobile-dev");
  await page.getByLabel("Contract type").selectOption("hourly");
  await page.getByLabel("Description, deliverables and success criteria").fill("Weekly Flutter maintenance: bug fixes, dependency updates and small features, tracked with timesheets.");
  await page.getByLabel("Flutter", { exact: true }).check();
  await page.getByLabel("Budget maximum (or hourly max)").fill("40");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/app\/jobs\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Job is now open.")).toBeVisible();

  await signIn(page, "youssef@demo.workspring.test");
  await page.goto(`/jobs?q=${encodeURIComponent("E2E hourly support")}`);
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("link", { name: "Submit a proposal" }).click();
  await page.getByLabel(/Your hourly rate/).fill("30");
  await page.getByLabel("Cover letter").fill("I maintain Flutter apps weekly and keep clear time logs with memos for every entry.");
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByText("Proposal sent.")).toBeVisible();
  const proposalUrl = clean(page.url());

  await signIn(page, "client-atlas@demo.workspring.test");
  await page.goto(proposalUrl);
  await page.getByLabel("Scope and deliverables").fill("Weekly Flutter maintenance with timesheets.");
  await page.getByLabel(/Allow manual time entries/).check();
  await page.getByRole("button", { name: "Send offer" }).click();
  await page.waitForURL(/\/app\/offers\//);
  const offerUrl = clean(page.url());

  await signIn(page, "youssef@demo.workspring.test");
  await page.goto(offerUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Accept offer and start contract" }).click();
  await page.waitForURL(/\/app\/contracts\//);
  const contractUrl = clean(page.url());
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await page.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await page.getByLabel("Date (UTC)").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Minutes").fill("45");
  await page.getByLabel("Memo").last().fill("Fixed the offline sync crash");
  await page.getByRole("button", { name: "Add entry" }).click();
  await expect(page.getByText("Fixed the offline sync crash").first()).toBeVisible();
  await page.screenshot({ path: `${shots}/06-hourly-workroom.png`, fullPage: true });
  await page.getByRole("button", { name: "Submit timesheet" }).first().click();
  await expect(page.getByText("submitted", { exact: true }).first()).toBeVisible();

  await signIn(page, "client-atlas@demo.workspring.test");
  await page.goto(contractUrl);
  await page.getByRole("button", { name: /^Approve and pay / }).click();
  await page.getByRole("button", { name: "Simulate provider: payment succeeded" }).click();
  await page.waitForURL(/webhook=applied/);
  await expect(page.getByText("paid", { exact: true }).first()).toBeVisible();
});

test("admin: non-staff get 404; freelancer submits a service; moderator approves; it is public", async ({ page }) => {
  const title = `E2E data cleaning service ${Date.now()}`;
  await signIn(page, "client-olive@demo.workspring.test");
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);

  await signIn(page, "amira@demo.workspring.test");
  await page.goto("/app/services/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Category").selectOption("data-ai");
  await page.getByLabel("Summary").fill("Clean and validate your CSV data with a short quality report.");
  await page.getByLabel("Description").fill("I will clean, de-duplicate and validate your CSV or spreadsheet data and deliver the cleaned file plus a short quality report describing every change.");
  for (const [t, price, days] of [["starter", "50", "2"], ["standard", "90", "3"], ["advanced", "150", "5"]] as const) {
    await page.locator(`input[name="${t}_name"]`).fill(`${t} clean`);
    await page.locator(`textarea[name="${t}_description"]`).fill(`The ${t} package with a quality report.`);
    await page.locator(`input[name="${t}_price"]`).fill(price);
    await page.locator(`input[name="${t}_days"]`).fill(days);
  }
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/app\/services\/[0-9a-f-]{36}\?created=1/);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.waitForURL(/status=pending_review/);

  await signIn(page, "moderator@demo.workspring.test");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  await page.goto("/admin/moderation");
  const item = page.getByTestId("moderation-item").filter({ hasText: title });
  await expect(item).toBeVisible();
  await page.screenshot({ path: `${shots}/05-admin-moderation.png`, fullPage: true });
  await item.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.getByText("Moderation decision recorded.")).toBeVisible();
  // moderator role cannot read the audit log
  await page.goto("/admin/audit");
  await expect(page.getByText("Not available for your staff role")).toBeVisible();

  await page.goto(`/services?q=${encodeURIComponent("E2E data cleaning")}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});
