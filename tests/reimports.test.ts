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

test("identical and overlapping exports add only genuinely new trips and keep both originals", async () => {
  const first = await upload().then((r) => r.json());
  const repeat = await upload().then((r) => r.json());
  expect(repeat).toMatchObject({ tripCount: 0, newCount: 0, unchangedCount: 2, changedCount: 0 });
  const extra =
    "20.06.2025;10:00;10:30;0:30;52.1 , 13.1;52.2 , 13.2;20.0;14153;6.0;1.67;2.00;Freizeit\n";
  const overlap = await upload(csv + extra).then((r) => r.json());
  expect(overlap).toMatchObject({ tripCount: 1, newCount: 1, unchangedCount: 2, changedCount: 0 });
  expect((await fetch(`${base}/api/trips`).then((r) => r.json())).trips).toHaveLength(3);
  expect(await fetch(`${base}/api/imports/${first.id}/file`).then((r) => r.text())).toBe(csv);
  expect(await fetch(`${base}/api/imports/${repeat.id}/file`).then((r) => r.text())).toBe(csv);
});

test("changed values are previewed without mutation and only the immutable preview can be confirmed", async () => {
  const first = await upload().then((r) => r.json());
  const before = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips;
  const revised = csv.replace(";7.2;1.67;7.21;Geschäftlich", ";8.5;1.90;9.69;Freizeit");
  const response = await upload(revised);
  expect(response.status).toBe(202);
  const preview = await response.json();
  expect(preview).toMatchObject({
    newCount: 0,
    unchangedCount: 1,
    changedCount: 1,
    changes: [
      {
        before: { consumption: 7.2, fuelPrice: 1.67, cost: 7.21, category: "Geschäftlich" },
        after: { consumption: 8.5, fuelPrice: 1.9, cost: 9.69, category: "Freizeit" },
        fields: ["consumption", "fuelPrice", "cost", "category"],
      },
    ],
  });
  expect((await fetch(`${base}/api/trips`).then((r) => r.json())).trips).toEqual(before);
  const confirmed = await fetch(`${base}/api/imports/${preview.token}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applyChanges: true, changes: [{ cost: 1 }] }),
  });
  expect(confirmed.status).toBe(201);
  const result = await confirmed.json();
  expect(result).toMatchObject({ tripCount: 1, changedCount: 1, appliedCount: 1 });
  const after = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips;
  const detail = await fetch(`${base}/api/trips/${before[0].id}`).then((r) => r.json());
  expect(detail.source).toMatchObject({
    import: { id: result.id },
    values: { "Durchschn Verbrauch  (l/100km)": "8.5", "Kosten  (EUR)": "9.69" },
  });
  expect(after).toMatchObject([
    { id: before[0].id, importId: result.id, consumption: 8.5, cost: 9.69 },
    { id: before[1].id, importId: first.id },
  ]);
  expect(await fetch(`${base}/api/imports/${first.id}/file`).then((r) => r.text())).toBe(csv);
  expect(await fetch(`${base}/api/imports/${result.id}/file`).then((r) => r.text())).toBe(revised);
  expect(
    (
      await fetch(`${base}/api/imports/${preview.token}/confirm`, {
        method: "POST",
        body: JSON.stringify({ applyChanges: true }),
      })
    ).status,
  ).toBe(409);
});

test("new trips can be saved while changed known trips are deliberately left unchanged", async () => {
  await upload();
  const extra =
    "20.06.2025;10:00;10:30;0:30;52.1 , 13.1;52.2 , 13.2;20.0;14153;6.0;1.67;2.00;Freizeit\n";
  const revised = csv.replace(";7.2;1.67;7.21;", ";8.5;1.67;9.69;") + extra;
  const preview = await upload(revised).then((r) => r.json());
  expect(preview).toMatchObject({ newCount: 1, unchangedCount: 1, changedCount: 1 });
  const result = await fetch(`${base}/api/imports/${preview.token}/confirm`, {
    method: "POST",
    body: JSON.stringify({ applyChanges: false }),
  }).then((r) => r.json());
  expect(result).toMatchObject({ tripCount: 1, newCount: 1, changedCount: 1, appliedCount: 0 });
  const archive = (await fetch(`${base}/api/trips`).then((r) => r.json())).trips;
  expect(archive).toMatchObject([
    { date: "2025-06-20" },
    { consumption: 7.2, cost: 7.21 },
    { consumption: null },
  ]);
});

test("a stale preview cannot overwrite a newer archive and foreign websites cannot confirm it", async () => {
  await upload();
  const preview = await upload(csv.replace(";7.2;1.67;7.21;", ";8.5;1.67;9.69;")).then((r) =>
    r.json(),
  );
  const foreign = await fetch(`${base}/api/imports/${preview.token}/confirm`, {
    method: "POST",
    headers: { Origin: "https://other.example" },
    body: JSON.stringify({ applyChanges: true }),
  });
  expect(foreign.status).toBe(403);
  await upload(
    `${header}\n20.06.2025;10:00;10:30;0:30;52.1 , 13.1;52.2 , 13.2;20.0;14153;6.0;1.67;2.00;Freizeit\n`,
  );
  const stale = await fetch(`${base}/api/imports/${preview.token}/confirm`, {
    method: "POST",
    body: JSON.stringify({ applyChanges: true }),
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: expect.stringContaining("erneut") });
  expect((await fetch(`${base}/api/trips`).then((r) => r.json())).trips).toMatchObject([
    { date: "2025-06-20" },
    { consumption: 7.2, cost: 7.21 },
    { consumption: null },
  ]);
  expect((await fetch(`${base}/api/imports`).then((r) => r.json())).imports).toHaveLength(2);
});

test("identical duplicate rows within one file are skipped and conflicting duplicates are explained without changing the archive", async () => {
  const row = csv.split("\n")[2];
  const result = await upload(`${header}\n${row}\n${row}\n`).then((r) => r.json());
  expect(result).toMatchObject({ tripCount: 1, newCount: 1, unchangedCount: 1 });
  const conflicting = await upload(`${header}\n${row}\n${row.replace(";7.21;", ";8.00;")}\n`);
  expect(conflicting.status).toBe(400);
  expect(await conflicting.json()).toMatchObject({
    error: expect.stringContaining("widersprüchliche"),
  });
  expect((await fetch(`${base}/api/trips`).then((r) => r.json())).trips).toMatchObject([
    { cost: 7.21 },
  ]);
  expect((await fetch(`${base}/api/imports`).then((r) => r.json())).imports).toHaveLength(1);
});
