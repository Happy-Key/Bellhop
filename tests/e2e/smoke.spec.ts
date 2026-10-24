/**
 * Read-only smoke tests for the UI. The demo needs no backend. The workstation and customer
 * pages read from the Convex deployment in .env.local and change nothing: no case is created or
 * deleted, no call is started, no dialog is confirmed, no payout, retrieval or model call is triggered.
 */
import { expect, test } from "@playwright/test";

test("demo: scroll tells the story, the clarification changes the assessment, the workspace takes a local decision", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/review/demo");
  await expect(page.locator(".stage-title")).toHaveText("A customer calls.");
  await expect(page.getByText("Scripted replay · synthetic data")).toBeVisible();
  await page.locator(".story[data-ready]").waitFor();
  // Keys scroll by one beat; the stage is pinned.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(page.locator(".stage-title")).toHaveText("Bitdeer investigates.");
  await expect(page.locator(".d-interp strong")).toHaveText("Possible unauthorized payment");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".stage-title")).toHaveText("The assessment changes.");
  await expect(page.locator(".d-interp s")).toHaveText("Possible unauthorized payment");
  await expect(page.locator(".d-interp strong")).toContainText("induced by a bank impersonator");
  await expect(page.locator(".d-ghost")).toContainText("Previous assessment");
  await expect(page.locator(".d-docs li[data-flagged]")).toHaveCount(2);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".stage-title")).toHaveText("The customer adds one thing.");
  // The finale is the real workspace in demo mode.
  await page.locator("#demo-finale").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "Escalate to a specialist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await page.getByRole("tab", { name: /Record/ }).click();
  await expect(page.locator(".ins-record")).toContainText("Ask the customer");
  // A reviewer decision is applied on the page only.
  await page.getByRole("button", { name: "Decide differently" }).click();
  const dlg = page.locator("dialog[open]");
  await dlg.getByRole("combobox").selectOption("request_information");
  await dlg.getByRole("textbox").first().fill("Has the gift card balance already been redeemed?");
  await dlg.getByRole("textbox").last().fill("Recovery depends on whether the balance is still there.");
  await dlg.getByRole("button", { name: "Record" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".dec")).toContainText("Ask the customer");
  expect(errors).toEqual([]);
});

test("claims queue renders live cases or an honest empty state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Claims queue" })).toBeVisible();
  await expect(page.locator("[role=option], .empty").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a case opens from the queue with the keyboard: decision first, inspector beside it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/review");
  await expect(page.locator("[role=option], .empty").first()).toBeVisible();
  const rows = page.getByRole("option");
  test.skip((await rows.count()) === 0, "no cases on this deployment");
  await rows.first().click();
  await expect(page).toHaveURL(/[?&]case=/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/review\/[a-z0-9]+$/);
  await expect(page.locator(".dec")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rules and policy" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Record/ })).toBeVisible();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  expect(errors).toEqual([]);
});

test("customer line keeps presenter controls in a collapsed panel and does not start a call", async ({ page }) => {
  await page.goto("/call");
  await expect(page.getByRole("button", { name: "Start call" })).toBeVisible();
  await page.locator(".cc-presenter > summary").click();
  await page.getByRole("radio", { name: /Grace Nakamura/ }).click();
  await expect(page.getByRole("radio", { name: /Grace Nakamura/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".cc-presenter > summary")).toContainText("Calling as Grace Nakamura");
});
