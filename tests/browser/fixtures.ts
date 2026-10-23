import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

export const header =
  "Datum;Uhrzeit des Fahrbeginns;Uhrzeit der Ankunft;Dauer (S:Min);Adresse des Fahrbeginns;Adresse der Ankunft;Entfernung (km);Kilometerstand auf dem Zähler (km);Durchschn Verbrauch  (l/100km);Kraftstoffpreis (EUR/l);Kosten  (EUR);Kategorie";
export const csv = `${header}\n01.01.2024;08:00;08:30;0:30;52 , 13;52.1 , 13.1;10;1000;5;2;1;Freizeit\n02.01.2024;09:00;09:30;0:30;52 , 13;52.1 , 13.1;20;1020;10;2;4;Geschäftlich\n03.01.2024;10:00;10:15;0:15;52 , 13;;5;1025;;2;;Freizeit\n`;

// Each browser test uses the production build and its own real SQLite archive.
export const test = base.extend<{ app: string; browserErrors: void }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use();
      expect(errors, "The built interface must not throw uncaught errors").toEqual([]);
    },
    { auto: true },
  ],
  // Playwright requires a destructured fixture argument even without dependencies.
  // oxlint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), "fahrtenbuch-browser-"));
    const routing = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 18000,
              geometry: {
                type: "LineString",
                coordinates: [
                  [13, 52],
                  [13.05, 52.04],
                  [13.1, 52.1],
                ],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => routing.listen(0, "127.0.0.1", resolve));
    const address = routing.address();
    if (!address || typeof address === "string") throw new Error("Routing fixture did not bind");
    const server = spawn("bun", ["src/server.ts"], {
      env: {
        ...process.env,
        DATA_DIR: directory,
        HOST: "127.0.0.1",
        PORT: "0",
        APP_ORIGIN: "",
        OSRM_URL: `http://127.0.0.1:${address.port}`,
        OSRM_TIMEOUT_MS: "1000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    server.stderr.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 10000);
        let output = "";
        server.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          const ready = output.match(/"event":"ready","port":(\d+)/);
          if (ready) {
            clearTimeout(timeout);
            resolve(Number(ready[1]));
          }
        });
        server.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        server.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error(`Server exited: ${output} ${logs}`));
        });
      });
      await use(`http://127.0.0.1:${port}`);
    } finally {
      if (server.exitCode === null) {
        await new Promise<void>((resolve) => {
          server.once("exit", () => resolve());
          server.kill("SIGTERM");
        });
      }
      routing.closeAllConnections();
      await new Promise<void>((resolve) => routing.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
});

export { expect };

export async function importCsv(page: Page, content = csv) {
  if (await page.getByRole("button", { name: "CSV importieren", exact: true }).isVisible())
    await page.getByRole("button", { name: "CSV importieren", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-trips.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "Fahrten importieren", exact: true }).click();
}

export async function showAllTrips(page: Page) {
  await page.getByRole("combobox", { name: /^Zeitraum/ }).selectOption("all");
  await expect(
    page.getByRole("region", { name: "Fahrten im gewählten Zeitraum", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
}
