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

test("chart selections narrow only the table, preserve all filters and let users explore other periods", async ({
  page,
}) => {
  await importCsv(
    page,
    `${csv}01.02.2024;08:00;08:30;0:30;52 , 13;;10;1035;5;2;1;Freizeit\n29.02.2024;09:00;09:30;0:30;52 , 13;;20;1055;6;2;2;Freizeit\n01.03.2024;10:00;10:30;0:30;52 , 13;;10;1065;5;2;1;Freizeit\n`,
  );
  await expect(page.getByText("6 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  const from = page.getByLabel("Von", { exact: true });
  const to = page.getByLabel("Bis", { exact: true });
  const summary = page.getByRole("region", { name: "Kennzahlen der ausgewählten Fahrten" });
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await page.getByRole("combobox", { name: /^Kategorie/ }).selectOption("Freizeit");
  await expect(trips).toHaveCount(5);
  const months = page.getByRole("group", { name: "Kraftstoffkosten pro Monat", exact: true });
  await months.getByRole("button", { name: /^Feb/ }).click();
  await expect(
    page.getByRole("heading", { name: "Fahrten im Februar 2024", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Im Diagramm ausgewählt", { exact: true })).toBeVisible();
  await expect(trips).toHaveCount(2);
  await expect(summary.locator("dd").first()).toHaveText("5");
  await expect(months.getByRole("button")).toHaveCount(3);
  await expect(from).toHaveValue("");
  await expect(to).toHaveValue("");
  await expect(page.getByRole("combobox", { name: /^Zeitraum/ })).toHaveValue("all");
  await months.getByRole("button", { name: /^März/ }).click();
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 01.03.2024 um 10:00 ansehen");
  await page
    .getByRole("button", { name: "Alle Fahrten im Zeitraum anzeigen", exact: true })
    .click();
  await expect(trips).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "Fahrten im gewählten Zeitraum", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fahrten im gewählten Zeitraum", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("Im Diagramm ausgewählt", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^Kategorie/ })).toHaveValue("Freizeit");

  await page.getByRole("button", { name: "Gefahrene Kilometer vergrößern" }).click();
  const dialog = page.getByRole("dialog", { name: "Entwicklungen" });
  await dialog.getByRole("button", { name: "Täglich", exact: true }).click();
  await dialog.getByRole("button", { name: /^01.02.2024:/ }).click();
  await expect(
    page.getByRole("heading", { name: "Fahrten am 01.02.2024", exact: true, includeHidden: true }),
  ).toHaveCount(1);
  await dialog.getByRole("button", { name: /^29.02.2024:/ }).click();
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 29.02.2024 um 09:00 ansehen");
  await trips.click();
  const detail = page.getByRole("dialog", { name: "29.02.2024 · 09:00" });
  await expect(detail).toBeVisible();
  await detail.getByLabel("Verbrauch (l/100 km)", { exact: true }).fill("6.5");
  await detail.getByRole("button", { name: "Verbrauch speichern", exact: true }).click();
  await expect(detail.getByText("Gespeichert.", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fahrten am 29.02.2024", exact: true }),
  ).toBeVisible();
  await expect(summary.locator("dd").first()).toHaveText("5");
  await trips.click();
  await detail.getByLabel("Kategorie", { exact: true }).selectOption("Geschäftlich");
  await detail.getByRole("button", { name: "Kategorie speichern", exact: true }).click();
  await expect(detail.getByText("Gespeichert.", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(trips).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Fahrten am 29.02.2024", exact: true }),
  ).toBeVisible();
  const days = page.getByRole("group", { name: "Gefahrene Kilometer pro Tag", exact: true });
  await expect(days.getByRole("button").last()).toHaveAttribute("tabindex", "0");
  await days.getByRole("button", { name: /^01.02.2024:/ }).click();
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 01.02.2024 um 08:00 ansehen");
});

test("keyboard and slider selections filter the table without losing chart context", async ({
  page,
}) => {
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  await page.getByRole("button", { name: "Täglich", exact: true }).click();
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  const days = page.getByRole("group", { name: "Gefahrene Kilometer pro Tag", exact: true });
  const newest = days.getByRole("button", { name: /^03.01.2024:/ });
  await newest.focus();
  await expect(trips).toHaveCount(3);
  await newest.press("Home");
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 01.01.2024 um 08:00 ansehen");
  await expect(days.getByRole("button")).toHaveCount(3);
  await page.getByRole("button", { name: "Gefahrene Kilometer vergrößern" }).click();
  const dialog = page.getByRole("dialog", { name: "Entwicklungen" });
  await expect(dialog).toBeVisible();
  const slider = dialog.getByRole("slider", { name: "Zeitpunkt im Diagramm auswählen" });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "02.01.2024");
  await dialog.getByRole("button", { name: "Kosten", exact: true }).click();
  await expect(slider).toHaveAttribute("aria-valuetext", "02.01.2024");
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 02.01.2024 um 09:00 ansehen");
  await expect(page.getByLabel("Von", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Bis", { exact: true })).toHaveValue("");
});

test("the default 30-day overview stays available and changing filters clears the chart selection", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2024-01-31T12:00:00Z") });
  await page.reload();
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await expect(trips).toHaveCount(3);
  await page.getByRole("button", { name: "Täglich", exact: true }).click();
  const days = page.getByRole("group", { name: "Gefahrene Kilometer pro Tag", exact: true });
  await days.getByRole("button", { name: /^02.01.2024:/ }).click();
  await expect(trips).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Fahrten am 02.01.2024", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Von", { exact: true })).toHaveValue("2024-01-01");
  await expect(page.getByLabel("Bis", { exact: true })).toHaveValue("2024-01-31");
  await expect(days.getByRole("button")).toHaveCount(3);
  await days.getByRole("button", { name: /^01.01.2024:/ }).click();
  await expect(trips).toHaveAccessibleName("Fahrt vom 01.01.2024 um 08:00 ansehen");
  await page.getByRole("button", { name: "Monatlich", exact: true }).click();
  await expect(trips).toHaveCount(3);
  await expect(page.getByText("Im Diagramm ausgewählt", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Täglich", exact: true }).click();
  await days.getByRole("button", { name: /^02.01.2024:/ }).click();
  await page.getByRole("combobox", { name: /^Kategorie/ }).selectOption("Freizeit");
  await expect(trips).toHaveCount(2);
  await expect(page.getByText("Im Diagramm ausgewählt", { exact: true })).toHaveCount(0);
  await expect(days.getByRole("button")).toHaveCount(2);
});

test("manual date boundaries apply immediately, validate the range, and can be cleared", async ({
  page,
}) => {
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  const from = page.getByLabel("Von", { exact: true });
  const to = page.getByLabel("Bis", { exact: true });
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await from.fill("2024-01-02");
  await expect(trips).toHaveCount(2);
  await to.fill("2024-01-02");
  await expect(trips).toHaveCount(1);
  await from.fill("2024-01-03");
  await expect(page.getByRole("alert")).toContainText("Beginn");
  await expect(trips).toHaveCount(1);
  await to.fill("2024-01-03");
  await expect(trips).toHaveAccessibleName("Fahrt vom 03.01.2024 um 10:00 ansehen");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await from.fill("");
  await expect(trips).toHaveCount(3);
  await to.fill("");
  await expect(page.getByRole("status").filter({ hasText: /^Alle Fahrten$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /anwenden/i })).toHaveCount(0);
});

test("point selection, radius changes and removing the point apply without submitting", async ({
  page,
}) => {
  await importCsv(
    page,
    csv.replace("03.01.2024;10:00;10:15;0:15;52 , 13", "03.01.2024;10:00;10:15;0:15;53 , 14"),
  );
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  await page.getByText("Ortssuche", { exact: true }).click();
  const map = page.getByRole("region", { name: "Karte für die Ortssuche" });
  await map.focus();
  await map.press("Enter");
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 03.01.2024 um 10:00 ansehen");
  await page.getByLabel("Radius in km").fill("200");
  await expect(trips).toHaveCount(3);
  await page.getByRole("button", { name: "Punkt entfernen" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Alle Fahrten$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /anwenden/i })).toHaveCount(0);
});

test("a slower earlier filter response cannot replace the latest selection", async ({ page }) => {
  await importCsv(page);
  await expect(page.getByText("3 neue Fahrten · 0 Änderungen übernommen")).toBeVisible();
  await showAllTrips(page);
  const release: (() => void)[] = [];
  await page.route(/\/api\/(trips|analysis)\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get("category") !== "Freizeit") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise<void>((resolve) => release.push(resolve));
    await route.fulfill({ response });
  });
  const category = page.getByRole("combobox", { name: /^Kategorie/ });
  await category.selectOption("Freizeit");
  await expect.poll(() => release.length).toBe(2);
  await expect(category).toBeEnabled();
  await category.selectOption("Geschäftlich");
  const trips = page.getByRole("button", { name: /^Fahrt vom/ });
  await expect(trips).toHaveCount(1);
  for (const resolve of release) resolve();
  await page.unrouteAll({ behavior: "wait" });
  await expect(category).toHaveValue("Geschäftlich");
  await expect(trips).toHaveCount(1);
  await expect(trips).toHaveAccessibleName("Fahrt vom 02.01.2024 um 09:00 ansehen");
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
  await page
    .getByRole("group", { name: "Gefahrene Kilometer pro Monat", exact: true })
    .getByRole("button")
    .click();
  await expect(trips).toHaveCount(50);
  await expect(page.getByRole("button", { name: "Vorherige Fahrten" })).toBeDisabled();
  await page.getByRole("button", { name: "Nächste Fahrten" }).click();
  await expect(trips).toHaveCount(1);
  await page
    .getByRole("button", { name: "Alle Fahrten im Zeitraum anzeigen", exact: true })
    .click();
  await expect(trips).toHaveCount(50);
  await expect(trips.first()).toHaveAccessibleName("Fahrt vom 01.02.2024 um 00:01 ansehen");
  await page.getByRole("button", { name: "Nächste Fahrten" }).click();
  await expect(trips).toHaveCount(1);
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
