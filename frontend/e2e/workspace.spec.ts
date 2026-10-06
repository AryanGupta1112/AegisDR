import { test, expect } from "@playwright/test";
test("all routes render, live backup and isolated disaster recovery, responsive navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your backups, at a glance." }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByText("Connected", { exact: true }),
  ).toBeVisible();
  for (const route of [
    "/applications",
    "/applications/demo",
    "/backups",
    "/recovery",
    "/recovery/history",
    "/simulations",
    "/clusters",
    "/monitoring",
    "/activity",
    "/settings",
    "/not-a-route",
  ]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("Connect your workspace")).toHaveCount(0);
  }
  await page.goto("/backups");
  const backupResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/backups") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create backup", exact: true })
    .click();
  const backupJob = await (await backupResponse).json();
  await page.goto("/applications/demo");
  await expect(
    page
      .locator("tbody tr")
      .filter({ hasText: backupJob.id.slice(0, 10) })
      .getByText("Done", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.goto("/backups");
  await expect(
    page
      .locator("tbody tr")
      .filter({ hasText: "Atlas Notes" })
      .first()
      .getByText("Done", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .locator("tbody tr")
    .filter({ hasText: "Atlas Notes" })
    .first()
    .getByRole("link")
    .click();
  await expect(
    page.getByRole("heading", { name: "Backup contents" }),
  ).toBeVisible();
  await expect(page.getByText("files.tar.gz", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore this point" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("RESTORE Atlas Notes");
  const restoreResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/recovery") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm restore" }).click();
  const restoreJob = await (await restoreResponse).json();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/recovery/history");
  await expect(
    page
      .locator("tbody tr")
      .filter({ hasText: restoreJob.id.slice(0, 10) })
      .getByText("Done", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.goto("/simulations");
  await page
    .locator(".scenario")
    .filter({ hasText: "Lost records" })
    .getByRole("button")
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill("DISRUPT DEMO");
  const simulationResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/simulations") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start practice" }).click();
  const simulationJob = await (await simulationResponse).json();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .locator("tbody tr")
      .filter({ hasText: simulationJob.id.slice(0, 10) })
      .getByText("Done", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .locator("tbody tr")
    .filter({ hasText: simulationJob.id.slice(0, 10) })
    .getByRole("button", { name: "View details" })
    .click();
  await expect(
    page.getByText("Restored notes match the original"),
  ).toBeVisible();
  await page.getByLabel("Close dialog").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My apps", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My apps", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("registration, policy persistence, filtering, theme and safe removal", async ({
  page,
}) => {
  const suffix = Date.now().toString();
  await page.goto("/applications");
  await page.getByRole("button", { name: "Add app" }).click();
  await page.getByLabel("App name").fill(`Browser test ${suffix}`);
  await page.getByLabel("Folder to back up").fill(`browser-test-${suffix}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add app" })
    .click();
  await expect(
    page.getByRole("heading", { name: `Browser test ${suffix}` }),
  ).toBeVisible();
  await page.getByLabel("Save a backup every (minutes)").fill("90");
  await page.getByRole("button", { name: "Save backup settings" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Backup settings saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Save a backup every (minutes)")).toHaveValue(
    "90",
  );
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.getByRole("button", { name: "Remove app", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Remove Browser test ${suffix}` })
    .click();
  await expect(
    page.getByRole("heading", { name: "App not found" }),
  ).toBeVisible();
  await page.goto("/applications");
  await page.getByRole("textbox", { name: "Filter records" }).fill("Atlas");
  await expect(page.getByRole("link", { name: /Atlas Notes/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(`Browser test ${suffix}`) }),
  ).toHaveCount(0);
});

test("monochrome appearance, saved preferences, reduced motion and quiet caching", async ({
  page,
}) => {
  const chartRequests: string[] = [];
  page.on("request", (r) => {
    if (/\/assets\/charts-.*\.js/.test(r.url())) chartRequests.push(r.url());
  });
  await page.goto("/applications");
  await expect(
    page.getByRole("heading", { name: "My apps", exact: true }),
  ).toBeVisible();
  expect(chartRequests).toHaveLength(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your backups, at a glance." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/settings");
  await page.getByLabel("Screen animations").selectOption("reduced");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByLabel("Screen animations")).toHaveValue("reduced");
  expect(
    await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.hidden = true;
      document.body.append(probe);
      const grayscale = ["--accent", "--bg", "--text"].every((key) => {
        probe.style.color = `var(${key})`;
        const rgb = getComputedStyle(probe)
          .color.match(/[\d.]+/g)
          ?.slice(0, 3);
        return rgb?.length === 3 && rgb[0] === rgb[1] && rgb[1] === rgb[2];
      });
      probe.remove();
      return grayscale;
    }),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/light-settings.png",
    fullPage: true,
  });
  let reads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && /\/api\/(jobs|backups|settings)$/.test(r.url()))
      reads++;
  });
  // Unchanged SSE messages should not generate a fresh round of REST requests.
  await page.waitForTimeout(6500);
  expect(reads).toBeLessThanOrEqual(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByLabel("Screen animations").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});
