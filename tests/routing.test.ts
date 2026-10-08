import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const header =
  "Datum;Uhrzeit des Fahrbeginns;Uhrzeit der Ankunft;Dauer (S:Min);Adresse des Fahrbeginns;Adresse der Ankunft;Entfernung (km);Kilometerstand auf dem Zähler (km);Durchschn Verbrauch  (l/100km);Kraftstoffpreis (EUR/l);Kosten  (EUR);Kategorie";
const row =
  "07.10.2026;10:00;10:30;0:30;52.00000 , 13.00000;52.10000 , 13.10000;20;10000;7;1.6;2.24;Freizeit";
const geometry = {
  type: "LineString",
  coordinates: [
    [13, 52],
    [13.05, 52.04],
    [13.1, 52.1],
  ],
};
const successful = {
  code: "Ok",
  routes: [{ distance: 18000, duration: 1400, geometry }],
  waypoints: [],
};
let directory: string;
let processHandle: ChildProcess;
let base: string;
let external: Server;
let externalBase: string;
let requests: { url: string; at: number; agent: string | undefined }[];
let externalResponse: unknown;
let responseDelay: number;
let externalStatus: number;
let logs: string;

async function start() {
  logs = "";
  processHandle = spawn("bun", ["src/server.ts"], {
    env: {
      ...process.env,
      PORT: "0",
      DATA_DIR: directory,
      HOST: "127.0.0.1",
      OSRM_URL: externalBase,
      OSRM_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
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
    processHandle.once("error", reject);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Server exited: ${output} ${logs}`));
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
async function upload(rows = row) {
  const form = new FormData();
  form.set("file", new File([`${header}\n${rows}\n`], "fahrten.csv", { type: "text/csv" }));
  return fetch(`${base}/api/imports`, { method: "POST", body: form });
}
async function trips(): Promise<{ id: number; distanceKm: number }[]> {
  return (await fetch(`${base}/api/trips`).then((r) => r.json())).trips;
}
const route = (id: number) => fetch(`${base}/api/trips/${id}/route`);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fahrtenbuch-routing-"));
  requests = [];
  externalResponse = successful;
  responseDelay = 0;
  externalStatus = 200;
  external = createServer((request, response) => {
    requests.push({ url: request.url ?? "", at: Date.now(), agent: request.headers["user-agent"] });
    setTimeout(() => {
      response.statusCode = externalStatus;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(externalResponse));
    }, responseDelay);
  });
  await new Promise<void>((resolve) => external.listen(0, "127.0.0.1", resolve));
  const address = external.address();
  if (!address || typeof address === "string") throw new Error("Routing fixture did not bind");
  externalBase = `http://127.0.0.1:${address.port}`;
  await start();
});
afterEach(async () => {
  await stop();
  external.closeAllConnections();
  await new Promise<void>((resolve) => external.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
test("opening one trip reconstructs a route without replacing the source distance", async () => {
  await upload();
  const [trip] = await trips();
  await fetch(`${base}/api/trips/${trip.id}`);
  expect(requests).toHaveLength(0);
  const response = await route(trip.id);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ready",
    distanceKm: 18,
    differenceKm: -2,
    geometry,
  });
  expect(await trips()).toMatchObject([{ id: trip.id, distanceKm: 20 }]);
  expect(requests[0].url).toBe(
    "/route/v1/driving/13,52;13.1,52.1?overview=full&geometries=geojson&steps=false",
  );
  expect(requests[0].agent).toContain("Fahrtenarchiv/");
});
test("stored routes survive restart and new source coordinates require a new reconstruction", async () => {
  await upload();
  const [trip] = await trips();
  const first = await route(trip.id).then((r) => r.json());
  await stop();
  await start();
  externalResponse = { code: "NoRoute" };
  expect(await route(trip.id).then((r) => r.json())).toEqual(first);
  expect(requests).toHaveLength(1);
  const preview = await upload(row.replace("52.10000 , 13.10000", "52.20000 , 13.20000")).then(
    (r) => r.json(),
  );
  expect(
    (
      await fetch(`${base}/api/imports/${preview.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyChanges: true }),
      })
    ).status,
  ).toBe(201);
  externalResponse = {
    ...successful,
    routes: [
      {
        distance: 25000,
        geometry: {
          type: "LineString",
          coordinates: [
            [13, 52],
            [13.2, 52.2],
          ],
        },
      },
    ],
  };
  expect(await route(trip.id).then((r) => r.json())).toMatchObject({
    status: "ready",
    distanceKm: 25,
    differenceKm: 5,
    geometry: {
      coordinates: [
        [13, 52],
        [13.2, 52.2],
      ],
    },
  });
  expect(requests).toHaveLength(2);
  expect(requests[1].url).toContain("13.2,52.2");
});
test("parallel detail views share one pending route and distinct routes respect the public rate limit", async () => {
  await upload(
    `${row}\n${row.replace("07.10.2026", "08.10.2026").replace("52.10000 , 13.10000", "52.20000 , 13.20000")}`,
  );
  const [second, first] = await trips();
  responseDelay = 150;
  const responses = await Promise.all([route(first.id), route(first.id), route(second.id)]);
  for (const response of responses)
    expect(await response.json()).toMatchObject({ status: "ready", distanceKm: 18 });
  expect(requests).toHaveLength(2);
  expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(990);
});
test("round trips and missing targets keep their imported distance without querying the routing service", async () => {
  await upload(
    [
      row.replace("52.10000 , 13.10000", "52.00000 , 13.00000"),
      row.replace("07.10.2026", "08.10.2026").replace("52.10000 , 13.10000", "52.00050 , 13.00000"),
      row.replace("07.10.2026", "09.10.2026").replace("52.10000 , 13.10000", ""),
      row
        .replace("07.10.2026", "10.10.2026")
        .replace("52.10000 , 13.10000", "52.00000 , 13.00000")
        .replace(";20;", ";0;"),
      row
        .replace("07.10.2026", "11.10.2026")
        .replace("52.10000 , 13.10000", "52.00050 , 13.00000")
        .replace(";20;", ";1;"),
    ].join("\n"),
  );
  const [short, zero, missing, nearby, identical] = await trips();
  for (const trip of [zero, nearby, identical])
    expect(await route(trip.id).then((r) => r.json())).toEqual({ status: "round-trip" });
  expect(await route(missing.id).then((r) => r.json())).toEqual({ status: "missing-target" });
  expect(requests).toHaveLength(0);
  expect(await route(short.id).then((r) => r.json())).toMatchObject({ status: "ready" });
  expect(requests).toHaveLength(1);
  expect((await trips()).map((trip) => trip.distanceKm)).toEqual([1, 0, 20, 20, 20]);
});
test("routing failures keep trip details available and can be retried instead of entering the cache", async () => {
  await upload();
  const [trip] = await trips();
  externalResponse = { code: "NoRoute", message: "No route between endpoints" };
  const failed = await route(trip.id);
  expect(failed.status).toBe(200);
  expect(await failed.json()).toEqual({ status: "unavailable" });
  expect((await fetch(`${base}/api/trips/${trip.id}`).then((r) => r.json())).trip).toMatchObject({
    distanceKm: 20,
    startLat: 52,
    endLat: 52.1,
  });
  expect(logs).toContain('"event":"routing_failed"');
  expect(logs).not.toContain("52.1");
  expect(logs).not.toContain("13.1");
  externalResponse = successful;
  expect(await route(trip.id).then((r) => r.json())).toMatchObject({ status: "ready" });
  expect(requests).toHaveLength(2);
});
test("a slow routing service times out and a later detail view can reconstruct the trip", async () => {
  await upload();
  const [trip] = await trips();
  responseDelay = 700;
  const began = Date.now();
  expect(await route(trip.id).then((r) => r.json())).toEqual({ status: "unavailable" });
  expect(Date.now() - began).toBeLessThan(650);
  responseDelay = 0;
  expect(await route(trip.id).then((r) => r.json())).toMatchObject({ status: "ready" });
  expect(requests).toHaveLength(2);
});
test("HTTP failures and invalid GeoJSON never become an apparently successful route", async () => {
  await upload();
  const [trip] = await trips();
  externalStatus = 503;
  expect(await route(trip.id).then((r) => r.json())).toEqual({ status: "unavailable" });
  externalStatus = 200;
  externalResponse = {
    ...successful,
    routes: [
      {
        distance: 18000,
        geometry: {
          type: "LineString",
          coordinates: [
            [13, 52],
            [13.1, 952.1],
          ],
        },
      },
    ],
  };
  expect(await route(trip.id).then((r) => r.json())).toEqual({ status: "unavailable" });
  externalResponse = successful;
  expect(await route(trip.id).then((r) => r.json())).toMatchObject({ status: "ready" });
  expect(requests).toHaveLength(3);
});
test("foreign websites cannot trigger transfer of trip coordinates to the routing service", async () => {
  await upload();
  const [trip] = await trips();
  for (const headers of [
    new Headers({ Origin: "https://foreign.example" }),
    new Headers({ "Sec-Fetch-Site": "cross-site" }),
    new Headers({ "Sec-Fetch-Site": "same-site" }),
  ]) {
    expect((await fetch(`${base}/api/trips/${trip.id}/route`, { headers })).status).toBe(403);
  }
  expect(requests).toHaveLength(0);
  expect(
    (
      await fetch(`${base}/api/trips/${trip.id}/route`, {
        headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
      })
    ).status,
  ).toBe(200);
  expect((await route(999999)).status).toBe(404);
});
