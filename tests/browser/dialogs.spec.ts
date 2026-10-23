import { expect, importCsv, showAllTrips, test } from "./fixtures";

for (const kind of ["trip", "chart", "time"] as const) {
  test(`${kind} dialog closes from its backdrop and Escape, preserves inside clicks and restores focus`, async ({
    page,
    app,
  }) => {
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.goto(app);
    await expect(page.getByRole("heading", { name: "Dein erster Import" })).toBeVisible();
    if (kind !== "time") {
      await importCsv(page);
      await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
      await showAllTrips(page);
    }
    const names = {
      trip: { opener: "Fahrt vom 02.01.2024 um 09:00 ansehen", dialog: "02.01.2024 · 09:00" },
      chart: { opener: "Gefahrene Kilometer vergrößern", dialog: "Entwicklungen" },
      time: { opener: "Zeitzone einstellen", dialog: "Uhrzeiten" },
    };
    const name = names[kind];
    const opener = page.getByRole("button", { name: name.opener, exact: true });
    const dialog = page.getByRole("dialog", { name: name.dialog, exact: true });
    await opener.click();
    await expect(dialog).toBeVisible();
    const heading = dialog.getByRole("heading", { name: name.dialog, exact: true });
    await heading.click();
    await expect(dialog).toBeVisible();
    // Clicking dialog padding must not be mistaken for clicking its backdrop.
    await dialog.click({ position: { x: 8, y: 8 } });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Open dialog has no bounds");
    // The mobile chart fills the viewport and has no visible backdrop.
    if (bounds.x > 1) {
      const content = await heading.boundingBox();
      if (!content) throw new Error("Dialog heading has no bounds");
      await page.mouse.move(content.x + content.width / 2, content.y + content.height / 2);
      await page.mouse.down();
      await page.mouse.move(1, bounds.y + bounds.height / 2);
      await page.mouse.up();
      await expect(dialog).toBeVisible();
      await page.mouse.click(1, bounds.y + bounds.height / 2);
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      if (kind === "chart") await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
      await opener.click();
      await expect(dialog).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    if (kind === "chart") await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await opener.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}

test("timezone dialog keeps its dismissal guard while applying a change", async ({ page, app }) => {
  await page.goto(app);
  await expect(page.getByRole("heading", { name: "Dein erster Import" })).toBeVisible();
  const opener = page.getByRole("button", { name: "Zeitzone einstellen", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Uhrzeiten", exact: true });
  await dialog.getByRole("combobox", { name: "Exportzeiten", exact: true }).selectOption("utc");
  await dialog.getByLabel("Anzeigezeitzone", { exact: true }).fill("Europe/Berlin");
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route(/\/api\/(trips|analysis)\?/, async (route) => {
    await promise;
    await route.continue();
  });
  try {
    await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Wird geladen…", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Open dialog has no bounds");
    await page.mouse.click(1, bounds.y + bounds.height / 2);
    await expect(dialog).toBeVisible();
  } finally {
    resolve();
  }
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});
