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

const metricsCsv = `${header}\n01.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1000;5;1.67;1;Freizeit\n02.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;30;1030;9;1.67;3;Geschäftlich\n03.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;20;1050;;1.67;7;Geschäftlich\n04.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;40;1090;1000;1.67;;Freizeit\n`;

test("missing-value selection follows effective corrections and keeps zero values complete", async () => {
  await upload(`${metricsCsv}05.06.2025;08:00;08:10;0:10;52 , 13;;0;1090;0;1.67;0;Freizeit\n`);
  const list = async () => fetch(`${base}/api/trips?missing=any`).then((r) => r.json());
  const selected = await list();
  expect(selected.trips.map((trip: { date: string }) => trip.date)).toEqual([
    "2025-06-04",
    "2025-06-03",
  ]);
  expect(await fetch(`${base}/api/analysis?missing=any`).then((r) => r.json())).toMatchObject({
    count: 2,
    distanceKm: 60,
    missingConsumptionCount: 1,
    missingCostCount: 1,
  });
  await correct(selected.trips[0].id, { cost: { value: 0 } });
  await correct(selected.trips[1].id, { consumption: { value: 0 } });
  expect((await list()).trips).toEqual([]);
  await correct(selected.trips[1].id, { consumption: { value: null } });
  expect((await list()).trips).toMatchObject([{ date: "2025-06-03", consumption: null }]);
  expect((await list()).trips).toHaveLength(1);
});

test("consumption and cost gaps can be selected separately with the same analysis and comparison filters", async () => {
  await upload(
    `${metricsCsv}05.06.2025;08:00;08:10;0:10;52 , 13;;0;1090;0;1.67;0;Freizeit\n06.06.2025;08:00;08:10;0:10;52 , 13;;1;1091;;1.67;;Geschäftlich\n30.05.2025;08:00;08:10;0:10;52 , 13;;10;990;;1.67;2;Geschäftlich\n`,
  );
  const list = async (missing: string) =>
    fetch(`${base}/api/trips?from=2025-06-01&missing=${missing}`);
  const consumption = await list("consumption");
  expect(consumption.status).toBe(200);
  expect((await consumption.json()).trips.map((trip: { date: string }) => trip.date)).toEqual([
    "2025-06-06",
    "2025-06-03",
  ]);
  const costs = await list("cost");
  expect(costs.status).toBe(200);
  expect((await costs.json()).trips.map((trip: { date: string }) => trip.date)).toEqual([
    "2025-06-06",
    "2025-06-04",
  ]);
  const analysis = await fetch(
    `${base}/api/analysis?from=2025-06-01&to=2025-06-06&missing=consumption&category=Gesch%C3%A4ftlich&compare=previous`,
  ).then((r) => r.json());
  expect(analysis).toMatchObject({
    count: 2,
    distanceKm: 21,
    missingConsumptionCount: 2,
    missingCostCount: 1,
    comparison: { count: 1, distanceKm: 10, missingConsumptionCount: 1, missingCostCount: 0 },
  });
  expect((await list("unknown")).status).toBe(400);
});

test("missing consumption can be explicitly calculated without changing source values or costs", async () => {
  await upload(
    `${header}\n06.10.2026;18:10;18:14;0:04;52 , 13;52.1 , 13.1;1.1;32055;;1.76;0.08;Freizeit\n`,
  );
  const { trips } = await fetch(`${base}/api/trips`).then((r) => r.json());
  const url = `${base}/api/trips/${trips[0].id}`;
  const detail = await fetch(url).then((r) => r.json());
  expect(detail.calculatedConsumption).toBeCloseTo(4.132231404958678, 12);
  expect(detail).toMatchObject({
    trip: { consumption: null, cost: 0.08 },
    corrections: { consumption: null },
    base: { consumption: null },
  });
  const saved = await correct(trips[0].id, { consumption: { calculated: true } });
  expect(saved.status).toBe(200);
  const correction = await saved.json();
  expect(correction.trip.consumption).toBeCloseTo(4.132231404958678, 12);
  expect(correction).toMatchObject({
    base: { consumption: null },
    corrections: { cost: null },
    trip: { cost: 0.08 },
  });
  await stop();
  await start();
  const persisted = await fetch(`${base}/api/trips/${trips[0].id}`).then((r) => r.json());
  expect(persisted.corrections.consumption.value).toBeCloseTo(4.132231404958678, 12);
  await correct(trips[0].id, { consumption: null });
  expect(await fetch(`${base}/api/trips/${trips[0].id}`).then((r) => r.json())).toMatchObject({
    trip: { consumption: null },
    corrections: { consumption: null },
  });
});

test("consumption proposals preserve zero costs and refuse missing costs or zero divisors", async () => {
  await upload(
    `${header}\n01.10.2026;08:00;08:10;0:10;52 , 13;;1;1000;;2;0;Freizeit\n02.10.2026;08:00;08:10;0:10;52 , 13;;0;1001;;2;1;Freizeit\n03.10.2026;08:00;08:10;0:10;52 , 13;;1;1002;;0;1;Freizeit\n04.10.2026;08:00;08:10;0:10;52 , 13;;1;1003;;2;;Freizeit\n`,
  );
  const { trips } = await fetch(`${base}/api/trips`).then((r) => r.json());
  for (const trip of trips) {
    const detail = await fetch(`${base}/api/trips/${trip.id}`).then((r) => r.json());
    const possible = trip.date === "2026-10-01";
    expect(detail.calculatedConsumption).toBe(possible ? 0 : null);
    expect((await correct(trip.id, { consumption: { calculated: true } })).status).toBe(
      possible ? 200 : 400,
    );
  }
  const missing = trips.find((trip: { date: string }) => trip.date === "2026-10-04");
  const changed = await correct(missing.id, { cost: { value: -4 } }).then((r) => r.json());
  expect(changed).toMatchObject({
    calculatedConsumption: -200,
    trip: { consumption: null },
    corrections: { consumption: null },
  });
});

test("daily developments group all trips on an export date and omit days without trips", async () => {
  await upload(
    `${header}\n31.01.2026;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1000;5;2;1;Freizeit\n31.01.2026;09:00;09:10;0:10;52 , 13;52.1 , 13.1;30;1030;9;2;3;Geschäftlich\n02.02.2026;08:00;08:10;0:10;52 , 13;;20;1050;;2;7;Geschäftlich\n`,
  );
  const analysis = await fetch(`${base}/api/analysis`).then((r) => r.json());
  expect(analysis.days).toMatchObject([
    { date: "2026-01-31", count: 2, distanceKm: 40, consumption: 8, cost: 4 },
    { date: "2026-02-02", count: 1, distanceKm: 20, consumption: null, cost: 7 },
  ]);
  expect(analysis.days).toHaveLength(2);
  const selected = await fetch(
    `${base}/api/analysis?from=2026-01-31&to=2026-01-31&category=Freizeit`,
  ).then((r) => r.json());
  expect(selected.days).toMatchObject([
    { date: "2026-01-31", count: 1, distanceKm: 10, consumption: 5, cost: 1 },
  ]);
});

test("comparison uses the preceding inclusive period or prior year and keeps actual source dates", async () => {
  await upload(
    `${header}\n01.10.2026;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1000;5;2;1;Freizeit\n03.10.2026;08:00;08:10;0:10;52 , 13;52.1 , 13.1;30;1030;9;2;3;Geschäftlich\n24.09.2026;08:00;08:10;0:10;52 , 13;52.1 , 13.1;20;900;6;2;2;Freizeit\n26.09.2026;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;910;12;2;4;Geschäftlich\n23.09.2026;08:00;08:10;0:10;52 , 13;52.1 , 13.1;999;880;99;2;99;Freizeit\n01.10.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;5;700;8;2;1;Freizeit\n03.10.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;15;715;4;2;2;Geschäftlich\n`,
  );
  const previous = await fetch(
    `${base}/api/analysis?from=2026-10-01&to=2026-10-07&compare=previous`,
  ).then((r) => r.json());
  expect(previous).toMatchObject({
    distanceKm: 40,
    consumption: 8,
    cost: 4,
    comparison: {
      from: "2026-09-24",
      to: "2026-09-30",
      distanceKm: 30,
      consumption: 8,
      cost: 6,
      days: [
        { date: "2026-10-01", sourceFrom: "2026-09-24", sourceTo: "2026-09-24", distanceKm: 20 },
        { date: "2026-10-03", sourceFrom: "2026-09-26", sourceTo: "2026-09-26", distanceKm: 10 },
      ],
      months: [
        { month: "2026-10", sourceFrom: "2026-09-24", sourceTo: "2026-09-26", distanceKm: 30 },
      ],
    },
  });
  const year = await fetch(`${base}/api/analysis?from=2026-10-01&to=2026-10-07&compare=year`).then(
    (r) => r.json(),
  );
  expect(year.comparison).toMatchObject({
    from: "2025-10-01",
    to: "2025-10-07",
    distanceKm: 20,
    consumption: 5,
    cost: 3,
    days: [
      { date: "2026-10-01", sourceFrom: "2025-10-01" },
      { date: "2026-10-03", sourceFrom: "2025-10-03" },
    ],
  });
});

test("comparison honors category, start-or-target radius and independent corrections", async () => {
  await upload(
    `${header}\n01.10.2026;08:00;08:10;0:10;52 , 13;;10;1000;5;2;1;Freizeit\n24.09.2026;08:00;08:10;0:10;53 , 14;52 , 13;20;900;6;2;2;Geschäftlich\n25.09.2026;08:00;08:10;0:10;53 , 14;53.1 , 14.1;999;999;99;2;99;Freizeit\n`,
  );
  const archive = await fetch(`${base}/api/trips`).then((r) => r.json());
  const prior = archive.trips.find((trip: { date: string }) => trip.date === "2026-09-24");
  expect(
    (
      await correct(prior.id, {
        category: { value: "Freizeit" },
        consumption: { value: 0 },
        cost: { value: null },
      })
    ).status,
  ).toBe(200);
  const result = await fetch(
    `${base}/api/analysis?from=2026-10-01&to=2026-10-07&compare=previous&category=Freizeit&lat=52&lng=13&radiusKm=1`,
  ).then((r) => r.json());
  expect(result).toMatchObject({
    count: 1,
    distanceKm: 10,
    consumption: 5,
    cost: 1,
    comparison: {
      count: 1,
      distanceKm: 20,
      consumption: 0,
      cost: null,
      missingCostCount: 1,
      days: [{ date: "2026-10-01", distanceKm: 20, consumption: 0, cost: null }],
    },
  });
});

test("calendar comparisons cross leap days without losing or duplicating historical trips", async () => {
  await upload(
    `${header}\n27.02.2024;08:00;08:10;0:10;52 , 13;;10;1000;5;2;1;Freizeit\n28.02.2024;08:00;08:10;0:10;52 , 13;;20;1020;5;2;2;Freizeit\n29.02.2024;08:00;08:10;0:10;52 , 13;;30;1050;5;2;3;Freizeit\n28.02.2023;08:00;08:10;0:10;52 , 13;;40;900;5;2;4;Freizeit\n`,
  );
  const previous = await fetch(
    `${base}/api/analysis?from=2024-03-01&to=2024-03-03&compare=previous`,
  ).then((r) => r.json());
  expect(previous.comparison).toMatchObject({
    from: "2024-02-27",
    to: "2024-02-29",
    distanceKm: 60,
    days: [
      { date: "2024-03-01", sourceFrom: "2024-02-27", distanceKm: 10 },
      { date: "2024-03-02", sourceFrom: "2024-02-28", distanceKm: 20 },
      { date: "2024-03-03", sourceFrom: "2024-02-29", distanceKm: 30 },
    ],
  });
  const year = await fetch(`${base}/api/analysis?from=2024-02-29&to=2024-02-29&compare=year`).then(
    (r) => r.json(),
  );
  expect(year.comparison).toMatchObject({
    from: "2023-02-28",
    to: "2023-02-28",
    distanceKm: 40,
    days: [{ date: "2024-02-29", sourceFrom: "2023-02-28", distanceKm: 40 }],
  });
  const reverse = await fetch(
    `${base}/api/analysis?from=2025-02-28&to=2025-03-01&compare=year`,
  ).then((r) => r.json());
  expect(reverse.comparison).toMatchObject({
    distanceKm: 50,
    count: 2,
    days: [
      {
        date: "2025-02-28",
        sourceFrom: "2024-02-28",
        sourceTo: "2024-02-29",
        distanceKm: 50,
        count: 2,
      },
    ],
  });
});

test("comparison requires both valid date bounds and a supported mode", async () => {
  for (const query of [
    "compare=previous",
    "from=2026-10-01&compare=year",
    "from=2026-10-01&to=2026-10-07&compare=unknown",
    "from=2026-10-07&to=2026-10-01&compare=previous",
  ]) {
    expect((await fetch(`${base}/api/analysis?${query}`)).status).toBe(400);
  }
});

test("readable signed consumption and costs survive import and contribute unchanged to summaries", async () => {
  const source = `${header}\n01.01.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1000;-5.0;2;-1.00;Freizeit\n01.02.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1010;0;2;0;Freizeit\n01.03.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1020;;2;;Freizeit\n01.04.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1030;+3.0;2;+2.00;Freizeit\n`;
  const imported = await upload(source).then((r) => r.json());
  expect(imported).toMatchObject({ newCount: 4, errorCount: 0 });
  const selection = await fetch(`${base}/api/trips`).then((r) => r.json());
  expect(selection.trips).toMatchObject([
    { consumption: 3, cost: 2 },
    { consumption: null, cost: null },
    { consumption: 0, cost: 0 },
    { consumption: -5, cost: -1 },
  ]);
  const detail = await fetch(`${base}/api/trips/${selection.trips[3].id}`).then((r) => r.json());
  expect(detail).toMatchObject({
    trip: { consumption: -5, cost: -1 },
    base: { consumption: -5, cost: -1 },
    source: { values: { "Durchschn Verbrauch  (l/100km)": "-5.0", "Kosten  (EUR)": "-1.00" } },
    calculatedCost: -1,
  });
  expect(await fetch(`${base}/api/imports/${imported.id}/file`).then((r) => r.text())).toBe(source);
  const analysis = await fetch(`${base}/api/analysis`).then((r) => r.json());
  expect(analysis).toMatchObject({
    count: 4,
    distanceKm: 40,
    cost: 1,
    consumptionDistanceKm: 30,
    missingConsumptionCount: 1,
    missingCostCount: 1,
    months: [
      { month: "2025-01", consumption: -5, cost: -1 },
      { month: "2025-02", consumption: 0, cost: 0 },
      { month: "2025-03", consumption: null, cost: null },
      { month: "2025-04", consumption: 3, cost: 2 },
    ],
  });
  expect(analysis.consumption).toBeCloseTo(-0.6666666666666666, 12);
});

test("summary weights consumption by known distance, preserves extreme values and sums costs independently", async () => {
  expect((await upload(metricsCsv)).status).toBe(201);
  const response = await fetch(`${base}/api/analysis`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    count: 4,
    distanceKm: 100,
    consumption: 504,
    cost: 11,
    missingConsumptionCount: 1,
    missingCostCount: 1,
    consumptionDistanceKm: 80,
    consumptionCoverage: 0.8,
  });
});

test("combined filters summarize every matching trip and respond to effective corrections", async () => {
  const rows = Array.from(
    { length: 51 },
    (_, i) =>
      `02.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;2;${2000 + i};10;1.67;0.2;Geschäftlich`,
  );
  await upload(`${metricsCsv}${rows.join("\n")}\n`);
  const query = "from=2025-06-02&to=2025-06-02&category=Gesch%C3%A4ftlich";
  const before = await fetch(`${base}/api/analysis?${query}`).then((r) => r.json());
  expect(before).toMatchObject({ count: 52, distanceKm: 132, missingConsumptionCount: 0 });
  expect(before.consumption).toBeCloseTo(9.772727272727273, 12);
  expect(before.cost).toBeCloseTo(13.2, 12);
  const id = (await fetch(`${base}/api/trips?${query}`).then((r) => r.json())).trips.find(
    (trip: { odometerKm: number }) => trip.odometerKm === 1030,
  ).id;
  expect((await correct(id, { consumption: { value: 0 }, cost: { value: null } })).status).toBe(
    200,
  );
  const changed = await fetch(`${base}/api/analysis?${query}`).then((r) => r.json());
  expect(changed.consumption).toBeCloseTo(7.7272727272727275, 12);
  expect(changed.cost).toBeCloseTo(10.2, 12);
  expect(changed.missingCostCount).toBe(1);
  await correct(id, { category: { value: "Freizeit" } });
  const filtered = await fetch(`${base}/api/analysis?${query}`).then((r) => r.json());
  expect(filtered).toMatchObject({
    count: 51,
    distanceKm: 102,
    consumption: 10,
    missingCostCount: 0,
  });
  expect(filtered.cost).toBeCloseTo(10.2, 12);
  expect((await fetch(`${base}/api/analysis?from=2025-02-30`)).status).toBe(400);
  expect((await fetch(`${base}/api/analysis?from=2025-06-02&to=2025-06-01`)).status).toBe(400);
  expect((await fetch(`${base}/api/analysis?category=Other`)).status).toBe(400);
});

test("empty and zero-distance selections remain missing while actual zero values are preserved", async () => {
  expect(await fetch(`${base}/api/analysis`).then((r) => r.json())).toMatchObject({
    count: 0,
    distanceKm: 0,
    consumption: null,
    cost: null,
    missingConsumptionCount: 0,
    missingCostCount: 0,
    consumptionDistanceKm: 0,
    consumptionCoverage: null,
  });
  await upload(
    `${header}\n01.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;0;1000;0;1.67;0;Freizeit\n02.06.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1010;;1.67;;Geschäftlich\n`,
  );
  expect(await fetch(`${base}/api/analysis`).then((r) => r.json())).toMatchObject({
    count: 2,
    distanceKm: 10,
    consumption: null,
    cost: 0,
    missingConsumptionCount: 1,
    missingCostCount: 1,
    consumptionDistanceKm: 0,
    consumptionCoverage: 0,
  });
  expect(
    await fetch(`${base}/api/analysis?category=Gesch%C3%A4ftlich`).then((r) => r.json()),
  ).toMatchObject({
    count: 1,
    distanceKm: 10,
    consumption: null,
    cost: null,
    missingConsumptionCount: 1,
    missingCostCount: 1,
  });
  const id = (await fetch(`${base}/api/trips?category=Gesch%C3%A4ftlich`).then((r) => r.json()))
    .trips[0].id;
  await correct(id, { consumption: { value: 0 } });
  expect(await fetch(`${base}/api/analysis`).then((r) => r.json())).toMatchObject({
    consumption: 0,
    consumptionCoverage: 1,
    consumptionDistanceKm: 10,
    cost: 0,
  });
});

test("month values use the export month, weighted distances and unchanged extreme costs", async () => {
  await upload(
    `${header}\n01.02.2025;23:50;00:10;0:20;52 , 13;52.1 , 13.1;10;1050;5;1.67;7000;Freizeit\n31.01.2025;08:00;09:00;1:00;52 , 13;52.1 , 13.1;30;1030;9;1.67;3;Geschäftlich\n30.01.2025;08:00;09:00;1:00;52 , 13;52.1 , 13.1;10;1000;5;1.67;1;Freizeit\n31.01.2025;10:00;10:10;0:10;52 , 13;52.1 , 13.1;20;1050;;1.67;7;Geschäftlich\n`,
  );
  const result = await fetch(`${base}/api/analysis`).then((r) => r.json());
  expect(result.months).toEqual([
    {
      month: "2025-01",
      count: 3,
      distanceKm: 60,
      consumption: 8,
      cost: 11,
      missingConsumptionCount: 1,
      missingCostCount: 0,
      consumptionDistanceKm: 40,
      consumptionCoverage: 2 / 3,
    },
    {
      month: "2025-02",
      count: 1,
      distanceKm: 10,
      consumption: 5,
      cost: 7000,
      missingConsumptionCount: 0,
      missingCostCount: 0,
      consumptionDistanceKm: 10,
      consumptionCoverage: 1,
    },
  ]);
});

test("monthly values follow filters and corrections across all pages without creating missing months", async () => {
  await upload(
    `${header}\n31.01.2025;08:00;09:00;1:00;52 , 13;52.1 , 13.1;10;1000;5;1.67;2;Geschäftlich\n01.03.2025;08:00;09:00;1:00;52 , 13;52.1 , 13.1;30;1030;;1.67;;Geschäftlich\n${Array.from({ length: 51 }, (_, i) => `31.01.2025;10:00;10:10;0:10;52 , 13;52.1 , 13.1;2;${2000 + i};10;1.67;1;Freizeit`).join("\n")}\n`,
  );
  const selected = await fetch(`${base}/api/trips?category=Gesch%C3%A4ftlich`).then((r) =>
    r.json(),
  );
  const march = selected.trips.find((trip: { date: string }) => trip.date === "2025-03-01");
  await correct(march.id, { consumption: { value: 0 }, cost: { value: 0 } });
  const result = await fetch(`${base}/api/analysis?from=2025-01-31&to=2025-03-01`).then((r) =>
    r.json(),
  );
  expect(
    result.months.map((month: { month: string; count: number }) => [month.month, month.count]),
  ).toEqual([
    ["2025-01", 52],
    ["2025-03", 1],
  ]);
  const filtered = await fetch(
    `${base}/api/analysis?from=2025-01-31&to=2025-03-01&category=Gesch%C3%A4ftlich`,
  ).then((r) => r.json());
  expect(filtered.months).toMatchObject([
    { month: "2025-01", count: 1, distanceKm: 10, consumption: 5, cost: 2 },
    { month: "2025-03", count: 1, distanceKm: 30, consumption: 0, cost: 0 },
  ]);
  await correct(march.id, {
    category: { value: "Freizeit" },
    consumption: { value: null },
    cost: { value: null },
  });
  const missing = await fetch(`${base}/api/analysis?from=2025-03-01&category=Freizeit`).then((r) =>
    r.json(),
  );
  expect(missing.months).toMatchObject([
    {
      month: "2025-03",
      consumption: null,
      cost: null,
      missingConsumptionCount: 1,
      missingCostCount: 1,
    },
  ]);
  const empty = await fetch(`${base}/api/analysis?from=2025-02-01&to=2025-02-28`).then((r) =>
    r.json(),
  );
  expect(empty.months).toEqual([]);
  expect(empty.odometer).toEqual([]);
});

test("odometer observations remain chronological by export date and departure even when the meter decreases", async () => {
  await upload(
    `${header}\n02.02.2025;08:00;09:00;1:00;52 , 13;52.1 , 13.1;50;900;5;1.67;2;Freizeit\n01.02.2025;23:50;00:10;0:20;52 , 13;52.1 , 13.1;20;1050;5;1.67;2;Geschäftlich\n01.02.2025;08:00;09:00;1:00;52 , 13;52.1 , 13.1;10;1000;5;1.67;2;Freizeit\n`,
  );
  const result = await fetch(`${base}/api/analysis`).then((r) => r.json());
  expect(result.odometer).toMatchObject([
    { date: "2025-02-01", startTime: "08:00", odometerKm: 1000 },
    { date: "2025-02-01", startTime: "23:50", odometerKm: 1050 },
    { date: "2025-02-02", startTime: "08:00", odometerKm: 900 },
  ]);
  const filtered = await fetch(`${base}/api/analysis?category=Gesch%C3%A4ftlich`).then((r) =>
    r.json(),
  );
  expect(filtered.odometer).toMatchObject([
    { date: "2025-02-01", startTime: "23:50", odometerKm: 1050 },
  ]);
});
