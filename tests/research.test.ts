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

test("inclusive export dates combine with category and keep newest-first ordering", async () => {
  await upload(
    `${csv}20.06.2025;23:55;00:10;0:16;52.00000 , 13.00000;;8.5;14142;;1.67;;Geschäftlich\n`,
  );
  const response = await fetch(
    `${base}/api/trips?from=2025-06-19&to=2025-06-20&category=Gesch%C3%A4ftlich`,
  );
  expect(response.status).toBe(200);
  const archive = await response.json();
  expect(archive.trips.map((trip: { date: string }) => trip.date)).toEqual([
    "2025-06-20",
    "2025-06-19",
  ]);
  const leisure = await fetch(
    `${base}/api/trips?from=2025-06-18&to=2025-06-19&category=Freizeit`,
  ).then((r) => r.json());
  expect(leisure.trips.map((trip: { date: string }) => trip.date)).toEqual(["2025-06-18"]);
  expect(await fetch(`${base}/api/trips?from=2026-01-01`).then((r) => r.json())).toEqual({
    trips: [],
  });
  expect((await fetch(`${base}/api/trips?from=2025-06-20&to=2025-06-19`)).status).toBe(400);
  expect((await fetch(`${base}/api/trips?from=2025-02-30`)).status).toBe(400);
});

test("trip details retain every original field and its archived source after a restart", async () => {
  const imported = await upload(
    `${header}\n20.06.2025;23:55;00:10;0:16;52.00000 , 13.00000;;8.5;14142;;1.67;;Geschäftlich\n`,
  ).then((r) => r.json());
  const list = await fetch(`${base}/api/trips`).then((r) => r.json());
  const id = list.trips[0].id;
  await stop();
  await start();
  const response = await fetch(`${base}/api/trips/${id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    trip: {
      id,
      date: "2025-06-20",
      startTime: "23:55",
      arrivalTime: "00:10",
      durationMinutes: 16,
      endLat: null,
      endLng: null,
      consumption: null,
      cost: null,
      fuelPrice: 1.67,
      odometerKm: 14142,
    },
    source: {
      import: { id: imported.id, filename: "fahrten.csv", tripCount: 1 },
      values: {
        Datum: "20.06.2025",
        "Uhrzeit des Fahrbeginns": "23:55",
        "Uhrzeit der Ankunft": "00:10",
        "Dauer (S:Min)": "0:16",
        "Adresse des Fahrbeginns": "52.00000 , 13.00000",
        "Adresse der Ankunft": "",
        "Entfernung (km)": "8.5",
        "Kilometerstand auf dem Zähler (km)": "14142",
        "Durchschn Verbrauch  (l/100km)": "",
        "Kraftstoffpreis (EUR/l)": "1.67",
        "Kosten  (EUR)": "",
        Kategorie: "Geschäftlich",
      },
    },
  });
  expect((await fetch(`${base}/api/trips/999999`)).status).toBe(404);
});

test("UTC export times display in the chosen zone without changing originals or reimport identity", async () => {
  const content = `${header}\n08.10.2026;05:56;06:00;0:04;52.0 , 13.0;52.1 , 13.1;1.1;32055;;1.76;0.08;Freizeit\n08.01.2026;05:56;06:00;0:04;52.0 , 13.0;52.1 , 13.1;1.1;31000;6.1;1.76;0.08;Freizeit\n`;
  await upload(content);
  const original = await fetch(`${base}/api/trips`).then((r) => r.json());
  const id = original.trips[0].id;
  await fetch(`${base}/api/trips/${id}/corrections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consumption: { value: 7.5 } }),
  });
  const displayed = await fetch(`${base}/api/trips?timeZone=Europe%2FBerlin`).then((r) => r.json());
  expect(displayed.trips).toMatchObject([
    { id, date: "2026-10-08", startTime: "07:56", arrivalTime: "08:00", consumption: 7.5 },
    { date: "2026-01-08", startTime: "06:56", arrivalTime: "07:00" },
  ]);
  const detail = await fetch(`${base}/api/trips/${id}?timeZone=Europe%2FBerlin`).then((r) =>
    r.json(),
  );
  expect(detail).toMatchObject({
    trip: { date: "2026-10-08", startTime: "07:56", durationMinutes: 4 },
    base: { date: "2026-10-08", startTime: "05:56", arrivalTime: "06:00" },
    source: { values: { "Uhrzeit des Fahrbeginns": "05:56" } },
    corrections: { consumption: { value: 7.5 } },
  });
  const reimported = await upload(content).then((r) => r.json());
  expect(reimported).toMatchObject({ newCount: 0, unchangedCount: 2 });
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toMatchObject({
    trips: [{ id, startTime: "05:56", consumption: 7.5 }, { startTime: "05:56" }],
  });
});

test("local dates control filtering and comparison, including midnight and the autumn clock change", async () => {
  await upload(
    `${header}\n07.10.2026;23:56;00:00;0:04;52.0 , 13.0;52.1 , 13.1;1;32000;7;1.76;1;Freizeit\n06.10.2026;23:56;00:00;0:04;52.0 , 13.0;52.1 , 13.1;2;31900;7;1.76;2;Freizeit\n25.10.2026;00:55;01:10;0:15;52.0 , 13.0;52.1 , 13.1;3;33000;7;1.76;3;Freizeit\n25.10.2026;01:20;01:30;0:10;52.0 , 13.0;52.1 , 13.1;4;33004;7;1.76;4;Freizeit\n`,
  );
  const query = "timeZone=Europe%2FBerlin&from=2026-10-08&to=2026-10-08";
  const filtered = await fetch(`${base}/api/trips?${query}`).then((r) => r.json());
  expect(filtered.trips).toMatchObject([
    { date: "2026-10-08", startTime: "01:56", arrivalTime: "02:00", arrivalDate: "2026-10-08" },
  ]);
  const analysis = await fetch(`${base}/api/analysis?${query}&compare=previous`).then((r) =>
    r.json(),
  );
  expect(analysis).toMatchObject({
    count: 1,
    distanceKm: 1,
    days: [{ date: "2026-10-08", distanceKm: 1 }],
    comparison: { from: "2026-10-07", to: "2026-10-07", distanceKm: 2 },
  });
  const autumn = await fetch(`${base}/api/trips?timeZone=Europe%2FBerlin&from=2026-10-25`).then(
    (r) => r.json(),
  );
  expect(autumn.trips).toMatchObject([
    { startTime: "02:20", odometerKm: 33004 },
    { startTime: "02:55", arrivalTime: "02:10", arrivalDate: "2026-10-25", odometerKm: 33000 },
  ]);
  const odometer = await fetch(
    `${base}/api/analysis?timeZone=Europe%2FBerlin&from=2026-10-25`,
  ).then((r) => r.json());
  expect(odometer.odometer.map((point: { odometerKm: number }) => point.odometerKm)).toEqual([
    33000, 33004,
  ]);
  expect((await fetch(`${base}/api/trips?timeZone=Unknown%2FZone`)).status).toBe(400);
  expect(
    (await fetch(`${base}/api/trips/${filtered.trips[0].id}?timeZone=Unknown%2FZone`)).status,
  ).toBe(400);
});
