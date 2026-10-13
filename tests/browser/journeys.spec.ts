import { readFile } from "node:fs/promises";
import { csv, expect, header, importCsv, showAllTrips, test } from "./fixtures";

test.beforeEach(async ({ page, app }) => {
  // Keep external tiles out of the tests; the API and routing boundary remain real.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto(app);
  await expect(page.getByRole("heading", { name: "Dein erster Import" })).toBeVisible();
});

test("trip details render endpoints and a route, and a saved correction survives reload and can be reset", async ({
  page,
}) => {
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  const opener = page.getByRole("button", { name: "Fahrt vom 02.01.2024 um 09:00 ansehen" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "02.01.2024 · 09:00" });
  await expect(dialog).toBeVisible();
  const map = dialog.getByRole("region", { name: "Karte mit Start und Ziel" });
  await expect(map.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(map.getByRole("button", { name: "Ziel", exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Kartenhintergrund konnte nicht vollständig geladen werden.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Rekonstruierte Route" })).toContainText("18 km");
  await expect(map.locator("svg path")).toBeVisible();
  await dialog.getByLabel("Verbrauch (l/100 km)", { exact: true }).fill("6.5");
  await dialog.getByRole("button", { name: "Verbrauch speichern" }).click();
  await expect(dialog.getByText("Gespeichert.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Import: 10 · Manuell korrigiert", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(opener).toBeFocused();
  const summary = page.getByRole("region", { name: "Kennzahlen der ausgewählten Fahrten" });
  await expect(summary).toContainText("6 l/100 km");
  await expect(summary).toContainText("5,00 €");
  await page.reload();
  await showAllTrips(page);
  await expect(summary).toContainText("6 l/100 km");
  await opener.click();
  await expect(dialog.getByLabel("Verbrauch (l/100 km)", { exact: true })).toHaveValue("6.5");
  await dialog.getByRole("button", { name: "Importwert verwenden", exact: true }).click();
  await expect(dialog.getByLabel("Verbrauch (l/100 km)", { exact: true })).toHaveValue("10");
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(summary).toContainText("8,3 l/100 km");
});

for (const applyChanges of [false, true]) {
  test(`a reimport avoids duplicates and changed values require an explicit ${applyChanges ? "accept" : "keep"} decision`, async ({
    page,
  }) => {
    await importCsv(page);
    await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
    await showAllTrips(page);
    await importCsv(page);
    await expect(page.getByText("0 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
    await expect(
      page.getByText("3 unveränderte Fahrten übersprungen.", { exact: false }),
    ).toBeVisible();
    const summary = page.getByRole("region", { name: "Kennzahlen der ausgewählten Fahrten" });
    await expect(summary.locator("dd").first()).toHaveText("3");

    await importCsv(page, csv.replace(";10;2;4;Geschäftlich", ";10;2;9;Geschäftlich"));
    await expect(page.getByRole("heading", { name: "1 bekannte Fahrt verändert" })).toBeVisible();
    await expect(summary).toContainText("5,00 €");
    await page
      .getByRole("button", {
        name: applyChanges ? "Änderungen übernehmen" : "Bisherige Werte behalten",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(`0 neue Fahrten · ${applyChanges ? "1 Änderung" : "0 Änderungen"} übernommen`),
    ).toBeVisible();
    await expect(summary.locator("dd").first()).toHaveText("3");
    await expect(summary).toContainText(applyChanges ? "10,00 €" : "5,00 €");
    await page.reload();
    await showAllTrips(page);
    await expect(summary).toContainText(applyChanges ? "10,00 €" : "5,00 €");
  });
}

test("a CSV imported through the built interface becomes an archive with an unchanged original", async ({
  page,
}) => {
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  const summary = page.getByRole("region", { name: "Kennzahlen der ausgewählten Fahrten" });
  await expect(summary.locator("dd").first()).toHaveText("3");
  await expect(summary).toContainText("35 km");
  await expect(summary).toContainText("8,3 l/100 km");
  await expect(summary).toContainText("5,00 €");
  await page.getByText("Originaldateien", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV herunterladen" }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error("Original download did not produce a file");
  expect(await readFile(path)).toEqual(Buffer.from(csv));
  await page.reload();
  await showAllTrips(page);
  await expect(summary.locator("dd").first()).toHaveText("3");
});

test("category and missing-value filters update the list and all summary values together", async ({
  page,
}) => {
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  const summary = page.getByRole("region", { name: "Kennzahlen der ausgewählten Fahrten" });
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await page.getByRole("combobox", { name: /^Kategorie/ }).selectOption("Geschäftlich");
  await expect(summary.locator("dd").first()).toHaveText("1");
  await expect(summary).toContainText("20 km");
  await expect(summary).toContainText("10 l/100 km");
  await expect(summary).toContainText("4,00 €");
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 02.01.2024 um 09:00 ansehen");

  await page.getByRole("combobox", { name: /^Angaben/ }).selectOption("consumption");
  await expect(
    page.getByRole("heading", { name: "Keine Fahrten für diese Auswahl" }),
  ).toBeVisible();
  await expect(summary.locator("dd").first()).toHaveText("0");
  await page.getByRole("combobox", { name: /^Kategorie/ }).selectOption("");
  await expect(summary.locator("dd").first()).toHaveText("1");
  await expect(summary).toContainText("5 km");
  await expect(summary).toContainText("Keine Angabe");
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 03.01.2024 um 10:00 ansehen");
  await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
  await expect(summary.locator("dd").first()).toHaveText("3");
  await expect(trips).toHaveCount(3);
});

test("sorting spans the whole archive before pagination and a filter resets the current page", async ({
  page,
  isMobile,
}) => {
  const rows = Array.from({ length: 51 }, (_, index) => {
    const distance = index + 1;
    const category = distance === 51 ? "Geschäftlich" : "Freizeit";
    return `01.02.2024;00:${String(distance).padStart(2, "0")};01:00;0:30;52 , 13;;${distance};${1000 + distance};5;2;1;${category}`;
  });
  await importCsv(page, `${header}\n${rows.join("\n")}\n`);
  await expect(page.getByText("51 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  if (isMobile)
    await page.getByRole("combobox", { name: "Sortieren nach" }).selectOption("distanceKm");
  else await page.getByRole("button", { name: "Entfernung aufsteigend sortieren" }).click();
  // The initial mobile direction is descending; toggle it to ascending.
  if (isMobile) await page.getByRole("button", { name: "Sortierung aufsteigend" }).click();
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await expect(trips).toHaveCount(50);
  await expect(trips.first()).toHaveAccessibleName("Fahrt vom 01.02.2024 um 00:01 ansehen");
  await expect(trips.last()).toHaveAccessibleName("Fahrt vom 01.02.2024 um 00:50 ansehen");
  const summary = page.getByRole("region", { name: "Kennzahlen der ausgewählten Fahrten" });
  await expect(summary.locator("dd").first()).toHaveText("51");
  await expect(summary).toContainText("1.326 km");
  await page.getByRole("button", { name: "Nächste Fahrten" }).click();
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 01.02.2024 um 00:51 ansehen");
  if (isMobile) await page.getByRole("button", { name: "Sortierung absteigend" }).click();
  else await page.getByRole("button", { name: "Entfernung absteigend sortieren" }).click();
  await expect(trips).toHaveCount(50);
  await expect(trips.first()).toHaveAccessibleName("Fahrt vom 01.02.2024 um 00:51 ansehen");
  await page.getByRole("button", { name: "Nächste Fahrten" }).click();
  await page.getByRole("combobox", { name: /^Kategorie/ }).selectOption("Geschäftlich");
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 01.02.2024 um 00:51 ansehen");
  await expect(page.getByRole("button", { name: "Vorherige Fahrten" })).toBeDisabled();
  await expect(summary.locator("dd").first()).toHaveText("1");
  await expect(summary).toContainText("51 km");
});
