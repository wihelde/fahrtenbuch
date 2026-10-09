import { resolve } from "node:path";
import { z } from "zod";
import { ImportConflictError, openArchive } from "./archive";
import { CsvImportError } from "./csv";
import {
  filtersSchema,
  analysisFiltersSchema,
  correctionPatchSchema,
  clockQuerySchema,
} from "./model";
import { createTripClock } from "./trip-clock";
import { analyze, compare } from "./analysis";
import { comparisonRange } from "./periods";
import { createRouting } from "./routing";

// A TLS proxy changes the upstream URL; trust its configured public origin as well.
const appOrigin = process.env.APP_ORIGIN
  ? new URL(z.url({ protocol: /^https?$/ }).parse(process.env.APP_ORIGIN)).origin
  : undefined;
const archive = openArchive(resolve(process.env.DATA_DIR ?? "data"));
const routing = createRouting(archive);
const frontend = resolve("dist");
const server = Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 10 * 1024 * 1024,
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    const foreignRequest =
      (origin !== null && origin !== url.origin && origin !== appOrigin) || site === "cross-site";
    if (url.pathname === "/api/imports" && request.method === "GET") {
      return Response.json(
        { imports: archive.imports() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const originalMatch = url.pathname.match(/^\/api\/imports\/([a-f0-9-]{36})\/file$/);
    if (originalMatch && request.method === "GET") {
      const original = archive.original(originalMatch[1]);
      if (!original)
        return Response.json({ error: "Originaldatei nicht gefunden." }, { status: 404 });
      return new Response(Bun.file(original.path), {
        headers: {
          "Content-Type": "text/csv",
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(original.filename)}`,
        },
      });
    }
    if (
      (url.pathname === "/api/trips" || url.pathname === "/api/analysis") &&
      request.method === "GET"
    ) {
      const query = Object.fromEntries(url.searchParams);
      const analysisFilters =
        url.pathname === "/api/analysis" ? analysisFiltersSchema.safeParse(query) : undefined;
      const filters = analysisFilters ?? filtersSchema.safeParse(query);
      if (!filters.success)
        return Response.json(
          {
            error:
              "Bitte gültige Datumsgrenzen, Kategorie und einen vollständigen Ort mit positivem Radius wählen. Ein Vergleich benötigt Von und Bis.",
          },
          { status: 400 },
        );
      const trips = archive.trips(filters.data);
      const analysis = url.pathname === "/api/analysis" ? analyze(trips) : undefined;
      let comparison;
      const mode = analysisFilters?.success ? analysisFilters.data.compare : undefined;
      if (mode && filters.data.from && filters.data.to) {
        const range = { from: filters.data.from, to: filters.data.to };
        const source = comparisonRange(range, mode);
        comparison = compare(archive.trips({ ...filters.data, ...source }), range, mode, source);
      }
      return Response.json(
        analysis ? { ...analysis, ...(comparison ? { comparison } : {}) } : { trips },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const routeMatch = url.pathname.match(/^\/api\/trips\/(\d+)\/route$/);
    if (routeMatch && request.method === "GET") {
      if (foreignRequest || site === "same-site") {
        return Response.json(
          { error: "Route bitte direkt in der Anwendung öffnen." },
          { status: 403 },
        );
      }
      const detail = archive.trip(Number(routeMatch[1]));
      if (!detail) return Response.json({ error: "Fahrt nicht gefunden." }, { status: 404 });
      return Response.json(await routing.route(detail.trip), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const tripMatch = url.pathname.match(/^\/api\/trips\/(\d+)$/);
    if (tripMatch && request.method === "GET") {
      const clock = clockQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!clock.success)
        return Response.json({ error: "Bitte eine gültige Zeitzone wählen." }, { status: 400 });
      const detail = archive.trip(Number(tripMatch[1]));
      return detail
        ? Response.json(
            { ...detail, trip: createTripClock(clock.data.timeZone)(detail.trip) },
            { headers: { "Cache-Control": "no-store" } },
          )
        : Response.json({ error: "Fahrt nicht gefunden." }, { status: 404 });
    }
    const correction = url.pathname.match(/^\/api\/trips\/(\d+)\/corrections$/);
    if (correction && request.method === "PATCH") {
      if (foreignRequest)
        return Response.json(
          { error: "Korrektur bitte direkt in der Anwendung speichern." },
          { status: 403 },
        );
      const patch = correctionPatchSchema.safeParse(await request.json().catch(() => null));
      if (!patch.success)
        return Response.json({ error: "Bitte gültige Korrekturwerte angeben." }, { status: 400 });
      if (!archive.correct(Number(correction[1]), patch.data))
        return Response.json({ error: "Fahrt nicht gefunden." }, { status: 404 });
      return Response.json(archive.trip(Number(correction[1])), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const confirmation = url.pathname.match(/^\/api\/imports\/([a-f0-9-]{36})\/confirm$/);
    if ((url.pathname === "/api/imports" || confirmation) && request.method === "POST") {
      if (foreignRequest) {
        return Response.json(
          { error: "Import bitte direkt in der Anwendung starten." },
          { status: 403 },
        );
      }
      if (confirmation) {
        const choice = z
          .object({ applyChanges: z.boolean() })
          .safeParse(await request.json().catch(() => null));
        if (!choice.success)
          return Response.json(
            { error: "Bitte ausdrücklich über die Änderungen entscheiden." },
            { status: 400 },
          );
        return Response.json(archive.confirm(confirmation[1], choice.data.applyChanges), {
          status: 201,
        });
      }
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return Response.json(
          { error: "Bitte eine CSV-Datei über die Dateiauswahl hochladen." },
          { status: 400 },
        );
      }
      const file = form.get("file");
      if (!(file instanceof File))
        return Response.json({ error: "Bitte eine CSV-Datei auswählen." }, { status: 400 });
      if (file.size > 10 * 1024 * 1024)
        return Response.json({ error: "Die CSV darf höchstens 10 MB groß sein." }, { status: 413 });
      const imported = archive.import(new Uint8Array(await file.arrayBuffer()), file.name);
      console.log(
        JSON.stringify({
          level: "info",
          event: "import",
          trips: "tripCount" in imported ? imported.tripCount : 0,
          errors: imported.errorCount,
          encoding: imported.encoding,
          delimiter: imported.delimiter,
        }),
      );
      // Keep diagnostic output short even when a large export is mostly invalid.
      for (const error of imported.errors.slice(0, 20))
        console.warn(JSON.stringify({ level: "warn", event: "import_row_error", ...error }));
      return Response.json(imported, { status: "token" in imported ? 202 : 201 });
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/" ||
        url.pathname === "/appearance.js" ||
        url.pathname === "/favicon.svg" ||
        url.pathname.startsWith("/assets/"))
    ) {
      const path = resolve(
        frontend,
        `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`,
      );
      if (path.startsWith(`${frontend}/`)) {
        const file = Bun.file(path);
        if (await file.exists())
          return new Response(file, {
            headers: {
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": url.pathname.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "no-cache",
              "Content-Security-Policy":
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
              "Referrer-Policy": "strict-origin-when-cross-origin",
            },
          });
      }
    }
    return Response.json({ error: "Nicht gefunden." }, { status: 404 });
  },
  error(error) {
    console.error(
      JSON.stringify(
        error instanceof CsvImportError
          ? { level: "warn", event: "import_rejected", reason: error.message }
          : { level: "error", event: "request_failed", type: error.name },
      ),
    );
    return Response.json(
      {
        error:
          error instanceof CsvImportError || error instanceof ImportConflictError
            ? error.message
            : "Die Anfrage konnte nicht gespeichert oder geladen werden. Bitte den Server prüfen.",
      },
      {
        status:
          error instanceof CsvImportError ? 400 : error instanceof ImportConflictError ? 409 : 500,
      },
    );
  },
});
console.log(JSON.stringify({ event: "ready", port: server.port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop(true);
    archive.close();
    process.exit(0);
  });
}
