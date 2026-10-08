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

// At the equator, one degree is 111.1950802335 km on the mean-radius sphere.
const nearbyCsv = `${header}\n01.01.2025;08:00;08:10;0:10;0 , 0.005;0 , 1;10;1000;5;1.67;1;Freizeit\n01.02.2025;08:00;08:10;0:10;0 , 1;0 , 0.005;30;1030;9;1.67;3;Geschäftlich\n02.02.2025;08:00;08:10;0:10;0 , 0.005;;20;1050;;1.67;7;Geschäftlich\n03.02.2025;08:00;08:10;0:10;0 , 1;0 , 2;40;1090;1000;1.67;7000;Freizeit\n`;

test("spatial search matches a nearby start or end, including a missing destination, without claiming a through-route", async () => {
  const imported = await upload(nearbyCsv);
  expect(imported.status).toBe(201);
  expect(await imported.json()).toMatchObject({ newCount: 4, errorCount: 0 });
  const query = "lat=0&lng=0&radiusKm=1";
  const selection = await fetch(`${base}/api/trips?${query}`).then((r) => r.json());
  expect(selection.trips.map((trip: { odometerKm: number }) => trip.odometerKm)).toEqual([
    1050, 1030, 1000,
  ]);
  const analysis = await fetch(`${base}/api/analysis?${query}`).then((r) => r.json());
  expect(analysis).toMatchObject({
    count: 3,
    distanceKm: 60,
    consumption: 8,
    cost: 11,
    missingConsumptionCount: 1,
  });
  expect(analysis.months).toMatchObject([
    { month: "2025-01", count: 1, distanceKm: 10, consumption: 5, cost: 1 },
    { month: "2025-02", count: 2, distanceKm: 50, consumption: 9, cost: 10 },
  ]);
  expect(analysis.odometer.map((trip: { odometerKm: number }) => trip.odometerKm)).toEqual([
    1000, 1030, 1050,
  ]);
});

test("the radius includes its boundary, crosses the date line and rejects incomplete or invalid coordinates", async () => {
  await upload(
    `${header}\n01.01.2025;08:00;08:10;0:10;0 , 1;;10;1000;5;1.67;1;Freizeit\n02.01.2025;08:00;08:10;0:10;0 , -179.995;;20;1020;5;1.67;2;Freizeit\n`,
  );
  const boundary = "lat=0&lng=0&radiusKm=111.1950802335329";
  expect((await fetch(`${base}/api/trips?${boundary}`).then((r) => r.json())).trips).toMatchObject([
    { odometerKm: 1000 },
  ]);
  expect(
    (await fetch(`${base}/api/trips?lat=0&lng=0&radiusKm=111.194`).then((r) => r.json())).trips,
  ).toEqual([]);
  expect(
    (await fetch(`${base}/api/trips?lat=0&lng=179.995&radiusKm=2`).then((r) => r.json())).trips,
  ).toMatchObject([{ odometerKm: 1020 }]);
  for (const query of [
    "lat=0",
    "lat=0&lng=0",
    "lat=&lng=0&radiusKm=1",
    "lat=91&lng=0&radiusKm=1",
    "lat=0&lng=181&radiusKm=1",
    "lat=0&lng=0&radiusKm=0",
    "lat=0&lng=0&radiusKm=-1",
    "lat=0&lng=0&radiusKm=NaN",
    "lat=0&lng=0&radiusKm=Infinity",
  ]) {
    expect((await fetch(`${base}/api/trips?${query}`)).status, query).toBe(400);
    expect((await fetch(`${base}/api/analysis?${query}`)).status, query).toBe(400);
  }
});

test("spatial, date and effective category filters keep list, summary, months and odometer on the same selection", async () => {
  await upload(nearbyCsv);
  const query = "lat=0&lng=0&radiusKm=1&from=2025-02-01&to=2025-02-02&category=Gesch%C3%A4ftlich";
  const before = await fetch(`${base}/api/trips?${query}`).then((r) => r.json());
  expect(before.trips).toHaveLength(2);
  const id = before.trips.find((trip: { odometerKm: number }) => trip.odometerKm === 1030).id;
  expect(
    (
      await fetch(`${base}/api/trips/${id}/corrections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: { value: "Freizeit" },
          consumption: { value: 0 },
          cost: { value: 0 },
        }),
      })
    ).status,
  ).toBe(200);
  const filtered = await fetch(`${base}/api/trips?${query}`).then((r) => r.json());
  expect(filtered.trips).toMatchObject([{ odometerKm: 1050 }]);
  const analysis = await fetch(`${base}/api/analysis?${query}`).then((r) => r.json());
  expect(analysis).toMatchObject({
    count: 1,
    distanceKm: 20,
    consumption: null,
    cost: 7,
    missingConsumptionCount: 1,
  });
  expect(analysis.months).toMatchObject([
    { month: "2025-02", count: 1, distanceKm: 20, consumption: null, cost: 7 },
  ]);
  expect(analysis.odometer).toMatchObject([{ id: filtered.trips[0].id, odometerKm: 1050 }]);
  const corrected = await fetch(
    `${base}/api/analysis?lat=0&lng=0&radiusKm=1&from=2025-02-01&category=Freizeit`,
  ).then((r) => r.json());
  expect(corrected).toMatchObject({ count: 1, distanceKm: 30, consumption: 0, cost: 0 });
  const empty = await fetch(`${base}/api/analysis?lat=80&lng=80&radiusKm=1`).then((r) => r.json());
  expect(empty).toMatchObject({
    count: 0,
    distanceKm: 0,
    consumption: null,
    cost: null,
    months: [],
    odometer: [],
  });
  expect((await fetch(`${base}/api/trips`).then((r) => r.json())).trips).toHaveLength(4);
});
