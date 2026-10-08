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
let logs = "";

// Run the real Bun server; Vitest observes only its public HTTP interface.
async function start() {
  logs = "";
  processHandle = spawn("bun", ["src/server.ts"], {
    env: { ...process.env, PORT: "0", DATA_DIR: directory, HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout?.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  processHandle.stderr?.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
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

async function upload(content: string | Uint8Array = csv) {
  const form = new FormData();
  form.set(
    "file",
    new File([typeof content === "string" ? content : new Uint8Array(content)], "fahrten.csv", {
      type: "text/csv",
    }),
  );
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

test("a partially invalid export keeps valid trips and explains the rejected physical row", async () => {
  const broken =
    csv + "31.02.2025;08:00;09:00;1:00;52.0 , 13.0;52.1 , 13.1;20.0;14153;6.0;1.67;2.0;Freizeit\n";
  const response = await upload(broken);
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result).toMatchObject({
    tripCount: 2,
    errorCount: 1,
    encoding: "UTF-8",
    delimiter: ";",
    errors: [{ line: 4, field: "Datum", reason: "Datum ist kein gültiger Kalendertag." }],
  });
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toMatchObject({
    trips: [{ date: "2025-06-19" }, { date: "2025-06-18" }],
  });
  const original = await fetch(`${base}/api/imports/${result.id}/file`);
  expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from(broken));
});

test("invalid numbers and incomplete or out-of-range coordinates report their fields while short trips remain valid", async () => {
  const rows = [
    "20.06.2025;08:00;08:00;0:00;52.0 , 13.0;;0.1;14134;;1.67;;Freizeit",
    "21.06.2025;08:00;09:00;1:00;91.0 , 13.0;52.1 , 13.1;20.0;14153;6.0;1.67;2.0;Freizeit",
    "22.06.2025;08:00;09:00;1:00;52.0 , 13.0;52.1;20.0;14173;6.0;1.67;2.0;Freizeit",
    "23.06.2025;08:00;09:00;1:00;52.0 , 13.0;52.1 , 13.1;unlesbar;14193;6.0;1.67;2.0;Freizeit",
  ];
  const result = await upload(`${header}\n${rows.join("\n")}\n`).then((r) => r.json());
  expect(result).toMatchObject({
    tripCount: 1,
    errorCount: 3,
    errors: [
      {
        line: 3,
        field: "Startkoordinaten",
        reason: "Breitengrad muss zwischen −90 und 90, Längengrad zwischen −180 und 180 liegen.",
      },
      {
        line: 4,
        field: "Zielkoordinaten",
        reason:
          "Koordinaten müssen ein vollständiges Zahlenpaar aus Breitengrad und Längengrad sein.",
      },
      { line: 5, field: "Entfernung", reason: "Zahl ist nicht eindeutig lesbar." },
    ],
  });
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toMatchObject({
    trips: [{ durationMinutes: 0, consumption: null, cost: null, endLat: null, endLng: null }],
  });
});

test("quoted European decimal commas and grouped numbers are interpreted consistently", async () => {
  const row = [
    "20.06.2025",
    "08:00",
    "09:00",
    "1:00",
    "52.0 , 13.0",
    "52.1 , 13.1",
    "1.234,5",
    "15.367",
    "7,2",
    "1,67",
    "148,44",
    "Geschäftlich",
  ]
    .map((value) => `"${value}"`)
    .join(";");
  const result = await upload(`${header}\n${row}\n`).then((r) => r.json());
  expect(result).toMatchObject({ tripCount: 1, errorCount: 0, encoding: "UTF-8", delimiter: ";" });
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toMatchObject({
    trips: [
      { distanceKm: 1234.5, odometerKm: 15367, consumption: 7.2, fuelPrice: 1.67, cost: 148.44 },
    ],
  });
});

test("BOM-marked UTF-16 and quoted comma or tab exports expose their encoding and delimiter", async () => {
  const records = [header.split(";"), csv.split("\n")[1].split(";")];
  const commaCsv =
    "\ufeff" + records.map((row) => row.map((value) => `"${value}"`).join(",")).join("\r\n");
  const result = await upload(Buffer.from(commaCsv, "utf16le")).then((r) => r.json());
  expect(result).toMatchObject({
    tripCount: 1,
    errorCount: 0,
    encoding: "UTF-16LE",
    delimiter: ",",
  });
  const original = await fetch(`${base}/api/imports/${result.id}/file`);
  expect(original.headers.get("content-type")).toBe("text/csv");
  expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from(commaCsv, "utf16le"));
  const tabs = "\ufeff" + records.map((row) => row.join("\t")).join("\n");
  expect(await upload(tabs).then((r) => r.json())).toMatchObject({
    tripCount: 0,
    unchangedCount: 1,
    errorCount: 0,
    encoding: "UTF-8",
    delimiter: "\t",
  });
});

test("signed European consumption and costs remain readable without guessing ambiguous separators", async () => {
  const source = `${header}\n01.01.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1000;-5,0;2;-1.234,56;Freizeit\n02.01.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1010;+7,25;2;+1,00;Freizeit\n03.01.2025;08:00;08:10;0:10;52 , 13;52.1 , 13.1;10;1020;-1,234;2;1;Freizeit\n`;
  expect(await upload(source).then((r) => r.json())).toMatchObject({
    newCount: 2,
    errorCount: 1,
    errors: [{ line: 4, field: "Verbrauch", reason: "Zahl ist nicht eindeutig lesbar." }],
  });
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toMatchObject({
    trips: [
      { consumption: 7.25, cost: 1 },
      { consumption: -5, cost: -1234.56 },
    ],
  });
});

test("row errors use starting physical line numbers and do not discard valid neighboring rows", async () => {
  const multiline = csv.split("\n")[1].replace("Freizeit", '"Freizeit\n"');
  const short = "22.06.2025;08:00";
  const ambiguous = csv.split("\n")[1].replace(";0.3;", ";1,234;");
  const source = `${header}\n\n${multiline}\n${csv.split("\n")[2]}\n${short}\n${ambiguous}\n`;
  const result = await upload(source).then((r) => r.json());
  expect(result).toMatchObject({
    tripCount: 1,
    errorCount: 3,
    errors: [
      { line: 3, field: "Kategorie" },
      { line: 6, field: "Zeile", reason: "Die Zeile enthält nicht alle zwölf CSV-Spalten." },
      { line: 7, field: "Entfernung", reason: "Zahl ist nicht eindeutig lesbar." },
    ],
  });
});

test("unreadable formats leave the archive unchanged and local logs explain safe import errors", async () => {
  await upload();
  const malformed = `${header}\n"unterminated`;
  const invalidBytes = new Uint8Array([0xff, 0xff, 0xff]);
  for (const source of [malformed, invalidBytes, "Datum;Fremde Spalte\n01.01.2025;x"]) {
    expect((await upload(source)).status).toBe(400);
  }
  expect(await fetch(`${base}/api/trips`).then((r) => r.json())).toMatchObject({
    trips: [{ date: "2025-06-19" }, { date: "2025-06-18" }],
  });
  expect(await fetch(`${base}/api/imports`).then((r) => r.json())).toMatchObject({
    imports: [{ tripCount: 2 }],
  });
  await upload(
    csv +
      "32.06.2025;08:00;09:00;1:00;52.98765 , 13.12345;52.1 , 13.1;20.0;14153;6.0;1.67;2.0;Freizeit\n",
  );
  await stop();
  expect(logs).toContain('"event":"import_rejected"');
  expect(logs).toContain(
    '"reason":"Kodierung ist nicht lesbar. Unterstützt sind UTF-8 sowie UTF-16 mit BOM."',
  );
  expect(logs).toContain('"event":"import_row_error"');
  expect(logs).toContain('"line":4');
  expect(logs).not.toContain("52.98765");
  expect(logs).not.toContain(header);
});
