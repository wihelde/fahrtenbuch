import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const header =
  "Datum;Uhrzeit des Fahrbeginns;Uhrzeit der Ankunft;Dauer (S:Min);Adresse des Fahrbeginns;Adresse der Ankunft;Entfernung (km);Kilometerstand auf dem Zähler (km);Durchschn Verbrauch  (l/100km);Kraftstoffpreis (EUR/l);Kosten  (EUR);Kategorie";
const csv = `${header}\n18.06.2025;05:49;05:50;0:02;52.00000 , 13.00000;52.00100 , 13.00100;0.3;14073;;1.67;0.17;Freizeit\n19.06.2025;08:00;09:00;1:01;52.00100 , 13.00100;52.10000 , 13.10000;60.0;14133;7.2;1.67;7.21;Geschäftlich\n`;

let directory: string;
let processHandle: ChildProcess;
let base: string;

// Run the real Bun server; Vitest observes only its public HTTP interface.
async function start() {
  processHandle = spawn("bun", ["src/server.ts"], {
    env: { ...process.env, PORT: "0", DATA_DIR: directory, HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start")), 10000);
    let output = "";
    processHandle.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const ready = output.match(/"event":"ready","port":(\d+)/);
      if (ready) {
        clearTimeout(timeout);
        resolve(Number(ready[1]));
      }
    });
    processHandle.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Server exited: ${output}`));
    });
  });
  base = `http://127.0.0.1:${port}`;
}

async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    processHandle.once("exit", () => resolve());
    processHandle.kill("SIGTERM");
  });
}

async function upload(content = csv) {
  const form = new FormData();
  form.set("file", new File([content], "fahrten.csv", { type: "text/csv" }));
  return fetch(`${base}/api/imports`, { method: "POST", body: form });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fahrtenbuch-test-"));
  await start();
});

afterEach(async () => {
  await stop();
  await rm(directory, { recursive: true, force: true });
});

async function correct(id: number, body: unknown, origin?: string) {
  return fetch(`${base}/api/trips/${id}/corrections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

test("manual values are effective in details and category search while originals survive a restart", async () => {
  const imported = await upload().then((r) => r.json());
  const id = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips[0].id;
  const saved = await correct(id, {
    category: { value: "Freizeit" },
    consumption: { value: 5.25 },
    cost: { value: 4.3 },
  });
  expect(saved.status).toBe(200);
  await stop();
  await start();
  const detail = await fetch(`${base}/api/trips/${id}`).then((r) => r.json());
  expect(detail).toMatchObject({
    trip: { category: "Freizeit", consumption: 5.25, cost: 4.3 },
    base: { category: "Geschäftlich", consumption: 7.2, cost: 7.21 },
    corrections: {
      category: { value: "Freizeit" },
      consumption: { value: 5.25 },
      cost: { value: 4.3 },
    },
    source: {
      import: { id: imported.id },
      values: { Kategorie: "Geschäftlich", "Kosten  (EUR)": "7.21" },
    },
  });
  expect(
    (await fetch(`${base}/api/trips?category=Freizeit`).then((r) => r.json())).trips,
  ).toHaveLength(2);
  expect(
    (await fetch(`${base}/api/trips?category=Gesch%C3%A4ftlich`).then((r) => r.json())).trips,
  ).toEqual([]);
  expect(await fetch(`${base}/api/imports/${imported.id}/file`).then((r) => r.text())).toBe(csv);
});

test("consumption alone leaves cost unchanged and calculated cost is adopted only explicitly without rounding", async () => {
  await upload();
  const id = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips[0].id;
  const response = await correct(id, { consumption: { value: 5.25 } });
  const detail = await response.json();
  expect(detail.trip).toMatchObject({ consumption: 5.25, cost: 7.21 });
  expect(detail.calculatedCost).toBeCloseTo(5.2605, 12);
  expect(detail.corrections.cost).toBeNull();
  const adopted = await correct(id, { cost: { calculated: true } });
  expect(adopted.status).toBe(200);
  const result = await adopted.json();
  expect(result.trip.cost).toBeCloseTo(5.2605, 12);
  expect(result.corrections.cost.value).toBeCloseTo(5.2605, 12);
  expect(result.base.cost).toBe(7.21);
});

test("an identical or extended export preserves saved calculated and manual corrections after restart", async () => {
  await upload();
  const before = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips;
  const missing = before[1].id;
  const manual = before[0].id;
  const adopted = await correct(missing, { consumption: { calculated: true } });
  expect(adopted.status).toBe(200);
  const calculated = await adopted.json();
  expect(calculated.trip.consumption).toBeCloseTo(33.9321357285, 9);
  expect(
    (
      await correct(manual, {
        category: { value: "Freizeit" },
        consumption: { value: 5.25 },
        cost: { value: 4.3 },
      })
    ).status,
  ).toBe(200);
  const savedManual = await fetch(`${base}/api/trips/${manual}`).then((r) => r.json());
  const duplicate = await upload();
  expect(duplicate.status).toBe(201);
  expect(await duplicate.json()).toMatchObject({ newCount: 0, changedCount: 0, unchangedCount: 2 });
  const extra =
    "20.06.2025;10:00;10:30;0:30;52.1 , 13.1;52.2 , 13.2;20.0;14153;6.0;1.67;2.00;Freizeit\n";
  const extended = await upload(csv + extra);
  expect(extended.status).toBe(201);
  expect(await extended.json()).toMatchObject({ newCount: 1, changedCount: 0, unchangedCount: 2 });
  await stop();
  await start();
  expect(await fetch(`${base}/api/trips/${missing}`).then((r) => r.json())).toEqual(calculated);
  expect(await fetch(`${base}/api/trips/${manual}`).then((r) => r.json())).toEqual(savedManual);
  expect((await fetch(`${base}/api/trips`).then((r) => r.json())).trips).toHaveLength(3);
});

test("confirmed reimports replace base values but preserve even explicitly missing corrections until reset", async () => {
  const first = await upload().then((r) => r.json());
  const id = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips[0].id;
  await correct(id, {
    category: { value: "Freizeit" },
    consumption: { value: null },
    cost: { value: 0 },
  });
  const updated = csv.replace(";7.2;1.67;7.21;Geschäftlich", ";8.5;1.90;9.69;Geschäftlich");
  const preview = await upload(updated).then((r) => r.json());
  expect(preview.changes[0].before).toMatchObject({ consumption: 7.2, cost: 7.21 });
  const imported = await fetch(`${base}/api/imports/${preview.token}/confirm`, {
    method: "POST",
    body: JSON.stringify({ applyChanges: true }),
  }).then((r) => r.json());
  await stop();
  await start();
  const detail = await fetch(`${base}/api/trips/${id}`).then((r) => r.json());
  expect(detail).toMatchObject({
    trip: { id, category: "Freizeit", consumption: null, cost: 0, fuelPrice: 1.9 },
    base: { consumption: 8.5, cost: 9.69, category: "Geschäftlich" },
    corrections: { consumption: { value: null }, cost: { value: 0 } },
    calculatedCost: null,
    source: { import: { id: imported.id }, values: { "Kosten  (EUR)": "9.69" } },
  });
  expect((await correct(id, { cost: { calculated: true } })).status).toBe(400);
  const reset = await correct(id, { category: null, consumption: null, cost: null }).then((r) =>
    r.json(),
  );
  expect(reset).toMatchObject({
    trip: { consumption: 8.5, cost: 9.69, category: "Geschäftlich" },
    corrections: { category: null, consumption: null, cost: null },
  });
  expect(await fetch(`${base}/api/imports/${first.id}/file`).then((r) => r.text())).toBe(csv);
  expect(await fetch(`${base}/api/imports/${imported.id}/file`).then((r) => r.text())).toBe(
    updated,
  );
});

test("foreign pages and invalid corrections cannot mutate an archived trip", async () => {
  await upload();
  const id = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips[0].id;
  const before = await fetch(`${base}/api/trips/${id}`).then((r) => r.json());
  expect((await correct(id, { consumption: { value: 5 } }, "https://other.example")).status).toBe(
    403,
  );
  expect((await correct(id, { consumption: { value: "-1" }, cost: { value: 4 } })).status).toBe(
    400,
  );
  expect((await correct(id, { category: { value: "Other" } })).status).toBe(400);
  expect((await correct(id, { cost: { value: "5" } })).status).toBe(400);
  expect((await correct(id, { odometerKm: 1 })).status).toBe(400);
  expect((await correct(999999, { cost: { value: 4 } })).status).toBe(404);
  expect(await fetch(`${base}/api/trips/${id}`).then((r) => r.json())).toEqual(before);
});

test("signed corrections stay independent through confirmed reimport, calculation and reset", async () => {
  await upload();
  const id = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips[0].id;
  const saved = await correct(id, { consumption: { value: -5 }, cost: { value: -2 } });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    trip: { consumption: -5, cost: -2 },
    base: { consumption: 7.2, cost: 7.21 },
    calculatedCost: -5.01,
  });
  const updated = csv.replace(";7.2;1.67;7.21;Geschäftlich", ";-8.5;1.90;-9.69;Geschäftlich");
  const preview = await upload(updated).then((r) => r.json());
  expect(preview).toMatchObject({
    errorCount: 0,
    changedCount: 1,
    changes: [{ after: { consumption: -8.5, cost: -9.69 } }],
  });
  expect(
    (
      await fetch(`${base}/api/imports/${preview.token}/confirm`, {
        method: "POST",
        body: JSON.stringify({ applyChanges: true }),
      })
    ).status,
  ).toBe(201);
  await stop();
  await start();
  expect(await fetch(`${base}/api/trips/${id}`).then((r) => r.json())).toMatchObject({
    trip: { consumption: -5, cost: -2 },
    base: { consumption: -8.5, cost: -9.69 },
    corrections: { consumption: { value: -5 }, cost: { value: -2 } },
  });
  const calculated = await correct(id, { cost: { calculated: true } }).then((r) => r.json());
  expect(calculated.trip.cost).toBeCloseTo(-5.7, 12);
  expect(calculated.corrections.cost.value).toBeCloseTo(-5.7, 12);
  expect(calculated.base.cost).toBe(-9.69);
  expect(await correct(id, { consumption: null, cost: null }).then((r) => r.json())).toMatchObject({
    trip: { consumption: -8.5, cost: -9.69 },
    corrections: { consumption: null, cost: null },
  });
});
