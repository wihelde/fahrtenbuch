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

test("a CSV becomes a newest-first archive with numeric values and genuine missing values", async () => {
  const response = await upload();
  expect(response.status).toBe(201);
  const archive = await fetch(`${base}/api/trips`).then((r) => r.json());
  expect(archive.trips).toMatchObject([
    {
      date: "2025-06-19",
      startTime: "08:00",
      arrivalTime: "09:00",
      durationMinutes: 61,
      distanceKm: 60,
      odometerKm: 14133,
      consumption: 7.2,
      fuelPrice: 1.67,
      cost: 7.21,
      category: "Geschäftlich",
      startLat: 52.001,
      startLng: 13.001,
      endLat: 52.1,
      endLng: 13.1,
    },
    {
      date: "2025-06-18",
      durationMinutes: 2,
      distanceKm: 0.3,
      consumption: null,
      cost: 0.17,
      category: "Freizeit",
    },
  ]);
});

test("a restart preserves the archive and the original export byte for byte", async () => {
  const imported = await upload().then((r) => r.json());
  await stop();
  await start();
  const archive = await fetch(`${base}/api/trips`).then((r) => r.json());
  expect(archive.trips).toHaveLength(2);
  const original = await fetch(`${base}/api/imports/${imported.id}/file`);
  expect(original.status).toBe(200);
  expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from(csv));
});

test("the archived import exposes its original filename and download link after a restart", async () => {
  await upload();
  await stop();
  await start();
  const response = await fetch(`${base}/api/imports`);
  expect(response.status).toBe(200);
  const history = await response.json();
  expect(history.imports).toMatchObject([{ filename: "fahrten.csv", tripCount: 2 }]);
  expect(history.imports[0].id).toEqual(expect.any(String));
});

test("a different website cannot submit an import to the private archive", async () => {
  const form = new FormData();
  form.set("file", new File([csv], "fahrten.csv"));
  const response = await fetch(`${base}/api/imports`, {
    method: "POST",
    body: form,
    headers: { Origin: "https://other.example" },
  });
  expect(response.status).toBe(403);
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toEqual({ trips: [] });
});
