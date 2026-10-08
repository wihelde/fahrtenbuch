import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endpointDistanceMeters } from "./geography";
import { CsvImportError, readTrips } from "./csv";
import {
  tripValuesSchema,
  tripDetailSchema,
  reconstructedRouteSchema,
  type ReconstructedRoute,
  type TripFilters,
  type Import,
  type ImportResult,
  type ImportPreview,
  type Trip,
  type TripValues,
  type CorrectionPatch,
} from "./model";

const identity = (trip: TripValues) => JSON.stringify([trip.date, trip.startTime, trip.odometerKm]);
const same = (a: TripValues, b: TripValues) =>
  Object.keys(tripValuesSchema.shape).every(
    (key) => a[key as keyof TripValues] === b[key as keyof TripValues],
  );

export class ImportConflictError extends Error {
  override name = "ImportConflictError";
}

/** Store original numeric values in SQLite; raw CSV strings remain separate. */
export function openArchive(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const originals = join(directory, "imports");
  mkdirSync(originals, { recursive: true, mode: 0o700 });
  const db = new Database(join(directory, "archive.sqlite"), { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.run(`
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, importedAt TEXT NOT NULL, tripCount INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY, importId TEXT NOT NULL REFERENCES imports(id),
      date TEXT NOT NULL, startTime TEXT NOT NULL, arrivalTime TEXT NOT NULL, durationMinutes INTEGER NOT NULL,
      startLat REAL NOT NULL, startLng REAL NOT NULL, endLat REAL, endLng REAL,
      distanceKm REAL NOT NULL, odometerKm INTEGER NOT NULL, consumption REAL, fuelPrice REAL NOT NULL,
      cost REAL, category TEXT NOT NULL, raw TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS routes (
      coordinates TEXT PRIMARY KEY, distanceKm REAL NOT NULL, geometry TEXT NOT NULL
    ) STRICT;
  `);
  // Add separate correction columns without rebuilding existing trips or their identity.
  const columns = new Set(
    db
      .query<{ name: string }, []>("PRAGMA table_info(trips)")
      .all()
      .map((column) => column.name),
  );
  for (const [column, type] of [
    ["categoryOverride", "TEXT"],
    ["consumptionOverride", "REAL"],
    ["costOverride", "REAL"],
    ["consumptionOverridden", "INTEGER NOT NULL DEFAULT 0"],
    ["costOverridden", "INTEGER NOT NULL DEFAULT 0"],
  ])
    if (!columns.has(column)) db.run(`ALTER TABLE trips ADD COLUMN ${column} ${type}`);
  const effectiveColumns = `id, importId, date, startTime, arrivalTime, durationMinutes,
    startLat, startLng, endLat, endLng, distanceKm, odometerKm, fuelPrice,
    CASE WHEN consumptionOverridden = 1 THEN consumptionOverride ELSE consumption END AS consumption,
    CASE WHEN costOverridden = 1 THEN costOverride ELSE cost END AS cost,
    COALESCE(categoryOverride, category) AS category`;
  const insertTrip = db.query(`INSERT INTO trips
    (importId, date, startTime, arrivalTime, durationMinutes, startLat, startLng, endLat, endLng,
     distanceKm, odometerKm, consumption, fuelPrice, cost, category, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const pending = new Map<
    string,
    {
      bytes: Uint8Array;
      filename: string;
      parsed: ReturnType<typeof readTrips>;
      preview: ImportPreview;
      revision: string;
      createdAt: number;
    }
  >();
  const revision = () => JSON.stringify(db.query("SELECT * FROM trips ORDER BY id").all());
  const fields = tripValuesSchema.keyof().options;
  const values = (trip: TripValues) => tripValuesSchema.parse(trip);
  function plan(parsed: ReturnType<typeof readTrips>, filename: string) {
    const existing = db.query<Trip, []>("SELECT * FROM trips").all();
    const unique = new Map<string, (typeof parsed.trips)[number]>();
    for (const row of parsed.trips) {
      const key = identity(row.trip);
      const duplicate = unique.get(key);
      if (duplicate && !same(duplicate.trip, row.trip))
        throw new CsvImportError(
          "Die Datei enthält widersprüchliche Werte für dieselbe Fahrtidentität (Datum, Startzeit, Kilometerstand). Bitte den Export prüfen.",
        );
      unique.set(key, row);
    }
    for (const key of unique.keys()) {
      if (existing.filter((trip) => identity(trip) === key).length > 1)
        throw new ImportConflictError(
          "Im Archiv liegen mehrere Fahrten mit derselben Identität. Bitte den bestehenden Bestand prüfen; es wurden keine Werte verändert.",
        );
    }
    const candidates = [...unique.values()];
    const newTrips = candidates.filter(
      ({ trip }) => !existing.some((known) => identity(known) === identity(trip)),
    );
    const changes = candidates.flatMap(({ trip }) => {
      const known = existing.find((row) => identity(row) === identity(trip));
      return known && !same(known, trip)
        ? [
            {
              id: known.id,
              before: values(known),
              after: trip,
              fields: fields.filter((field) => known[field] !== trip[field]),
            },
          ]
        : [];
    });
    return {
      newTrips,
      preview: {
        filename,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter,
        errors: parsed.errors,
        errorCount: parsed.errorCount,
        newCount: newTrips.length,
        unchangedCount: parsed.trips.length - newTrips.length - changes.length,
        changedCount: changes.length,
        changes,
        token: crypto.randomUUID(),
      },
    };
  }
  function save(
    bytes: Uint8Array,
    filename: string,
    parsed: ReturnType<typeof readTrips>,
    applyChanges: boolean,
  ): ImportResult {
    const { newTrips, preview } = plan(parsed, filename);
    const applied = applyChanges ? preview.changes : [];
    const imported = {
      id: crypto.randomUUID(),
      filename,
      importedAt: new Date().toISOString(),
      tripCount: newTrips.length + applied.length,
    };
    const path = join(originals, `${imported.id}.csv`);
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    try {
      db.transaction(() => {
        db.query(
          "INSERT INTO imports (id, filename, importedAt, tripCount) VALUES (?, ?, ?, ?)",
        ).run(imported.id, filename, imported.importedAt, imported.tripCount);
        for (const { trip: t, raw } of newTrips) {
          insertTrip.run(
            imported.id,
            t.date,
            t.startTime,
            t.arrivalTime,
            t.durationMinutes,
            t.startLat,
            t.startLng,
            t.endLat,
            t.endLng,
            t.distanceKm,
            t.odometerKm,
            t.consumption,
            t.fuelPrice,
            t.cost,
            t.category,
            raw,
          );
        }
        // Name only imported columns so future manual corrections retain their own values.
        for (const change of applied) {
          const t = change.after;
          const raw = parsed.trips.find((row) => identity(row.trip) === identity(t))!.raw;
          db.query(
            `UPDATE trips SET importId = ?, arrivalTime = ?, durationMinutes = ?, startLat = ?, startLng = ?, endLat = ?, endLng = ?, distanceKm = ?, consumption = ?, fuelPrice = ?, cost = ?, category = ?, raw = ? WHERE id = ?`,
          ).run(
            imported.id,
            t.arrivalTime,
            t.durationMinutes,
            t.startLat,
            t.startLng,
            t.endLat,
            t.endLng,
            t.distanceKm,
            t.consumption,
            t.fuelPrice,
            t.cost,
            t.category,
            raw,
            change.id,
          );
        }
      })();
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
    const { token: _token, changes: _changes, ...report } = preview;
    return { ...imported, ...report, appliedCount: applied.length };
  }
  const calculatedCost = (trip: Trip) => {
    if (trip.consumption === null) return null;
    const result = ((trip.distanceKm * trip.consumption) / 100) * trip.fuelPrice;
    return Number.isFinite(result) ? result : null;
  };
  // Derived values are proposals only; saving one still requires an explicit correction.
  const calculatedConsumption = (trip: Trip) => {
    if (trip.cost === null || trip.distanceKm <= 0 || trip.fuelPrice <= 0) return null;
    const value = (trip.cost / trip.fuelPrice / trip.distanceKm) * 100;
    return Number.isFinite(value) ? value : null;
  };
  return {
    cachedRoute(coordinates: string) {
      const cached = db
        .query<{ distanceKm: number; geometry: string }, [string]>(
          "SELECT distanceKm, geometry FROM routes WHERE coordinates = ?",
        )
        .get(coordinates);
      return cached
        ? reconstructedRouteSchema.parse({
            distanceKm: cached.distanceKm,
            geometry: JSON.parse(cached.geometry),
          })
        : null;
    },
    saveRoute(coordinates: string, route: ReconstructedRoute) {
      db.query(
        "INSERT OR REPLACE INTO routes (coordinates, distanceKm, geometry) VALUES (?, ?, ?)",
      ).run(coordinates, route.distanceKm, JSON.stringify(route.geometry));
    },
    imports() {
      return db.query<Import, []>("SELECT * FROM imports ORDER BY importedAt DESC, id DESC").all();
    },
    original(id: string) {
      const imported = db.query<Import, [string]>("SELECT * FROM imports WHERE id = ?").get(id);
      return imported ? { ...imported, path: join(originals, `${imported.id}.csv`) } : null;
    },
    trips(filters: TripFilters = {}) {
      return db
        .query<
          Trip,
          [string | null, string | null, string | null, string | null, string | null, string | null]
        >(`SELECT ${effectiveColumns}
        FROM trips WHERE (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?)
        AND (? IS NULL OR COALESCE(categoryOverride, category) = ?) ORDER BY date DESC, startTime DESC, id DESC`)
        .all(
          filters.from ?? null,
          filters.from ?? null,
          filters.to ?? null,
          filters.to ?? null,
          filters.category ?? null,
          filters.category ?? null,
        )
        .filter((trip) => {
          if (
            filters.missing &&
            (filters.missing === "any"
              ? trip.consumption !== null && trip.cost !== null
              : trip[filters.missing] !== null)
          )
            return false;
          if (
            filters.lat === undefined ||
            filters.lng === undefined ||
            filters.radiusKm === undefined
          )
            return true;
          // Include the boundary; one micrometre only absorbs floating-point roundoff.
          const limit = filters.radiusKm * 1000 + 0.000001;
          return (
            endpointDistanceMeters(filters.lat, filters.lng, trip.startLat, trip.startLng) <=
              limit ||
            (trip.endLat !== null &&
              trip.endLng !== null &&
              endpointDistanceMeters(filters.lat, filters.lng, trip.endLat, trip.endLng) <= limit)
          );
        });
    },
    trip(id: number) {
      const stored = db
        .query<
          Trip & {
            raw: string;
            categoryOverride: Trip["category"] | null;
            consumptionOverride: number | null;
            costOverride: number | null;
            consumptionOverridden: number;
            costOverridden: number;
          },
          [number]
        >("SELECT * FROM trips WHERE id = ?")
        .get(id);
      if (!stored) return null;
      const { raw, ...base } = stored;
      const trip = db
        .query<Trip, [number]>(`SELECT ${effectiveColumns} FROM trips WHERE id = ?`)
        .get(id)!;
      const corrections = {
        category: stored.categoryOverride === null ? null : { value: stored.categoryOverride },
        consumption: stored.consumptionOverridden ? { value: stored.consumptionOverride } : null,
        cost: stored.costOverridden ? { value: stored.costOverride } : null,
      };
      const imported = db
        .query<Import, [string]>("SELECT * FROM imports WHERE id = ?")
        .get(trip.importId);
      return tripDetailSchema.parse({
        trip,
        base,
        corrections,
        calculatedCost: calculatedCost(trip),
        calculatedConsumption: calculatedConsumption(trip),
        source: { import: imported, values: JSON.parse(raw) },
      });
    },
    correct(id: number, patch: CorrectionPatch) {
      if (!db.query("SELECT id FROM trips WHERE id = ?").get(id)) return false;
      db.transaction(() => {
        if (patch.category !== undefined)
          db.query("UPDATE trips SET categoryOverride = ? WHERE id = ?").run(
            patch.category?.value ?? null,
            id,
          );
        if (patch.consumption !== undefined) {
          let value: number | null;
          if (patch.consumption && "calculated" in patch.consumption) {
            const trip = db
              .query<Trip, [number]>(`SELECT ${effectiveColumns} FROM trips WHERE id = ?`)
              .get(id)!;
            value = calculatedConsumption(trip);
            if (value === null)
              throw new CsvImportError(
                "Für die Verbrauchsberechnung werden Kosten sowie eine positive Strecke und ein positiver Kraftstoffpreis benötigt.",
              );
          } else value = patch.consumption?.value ?? null;
          db.query(
            "UPDATE trips SET consumptionOverride = ?, consumptionOverridden = ? WHERE id = ?",
          ).run(value, patch.consumption === null ? 0 : 1, id);
        }
        if (patch.cost !== undefined) {
          let value: number | null;
          if (patch.cost && "calculated" in patch.cost) {
            const trip = db
              .query<Trip, [number]>(`SELECT ${effectiveColumns} FROM trips WHERE id = ?`)
              .get(id)!;
            if (trip.consumption === null)
              throw new CsvImportError("Ohne Verbrauch können keine Kosten berechnet werden.");
            value = ((trip.distanceKm * trip.consumption) / 100) * trip.fuelPrice;
            if (!Number.isFinite(value))
              throw new CsvImportError("Diese Werte sind für die Kostenberechnung zu groß.");
          } else value = patch.cost?.value ?? null;
          db.query("UPDATE trips SET costOverride = ?, costOverridden = ? WHERE id = ?").run(
            value,
            patch.cost === null ? 0 : 1,
            id,
          );
        }
      })();
      return true;
    },
    import(bytes: Uint8Array, filename: string): ImportResult | ImportPreview {
      const parsed = readTrips(bytes);
      const { preview } = plan(parsed, filename);
      if (!preview.changedCount) return save(bytes, filename, parsed, false);
      for (const [key, value] of pending)
        if (Date.now() - value.createdAt > 15 * 60 * 1000) pending.delete(key);
      if (pending.size >= 20) pending.delete(pending.keys().next().value!);
      pending.set(preview.token, {
        bytes,
        filename,
        parsed,
        preview,
        revision: revision(),
        createdAt: Date.now(),
      });
      return preview;
    },
    confirm(token: string, applyChanges: boolean) {
      const staged = pending.get(token);
      if (!staged || Date.now() - staged.createdAt > 15 * 60 * 1000)
        throw new ImportConflictError(
          "Die Vorschau ist nicht mehr verfügbar. Bitte die Datei erneut prüfen.",
        );
      if (staged.revision !== revision()) {
        pending.delete(token);
        throw new ImportConflictError(
          "Das Archiv hat sich seit der Vorschau verändert. Bitte die Datei erneut prüfen.",
        );
      }
      const imported = save(staged.bytes, staged.filename, staged.parsed, applyChanges);
      pending.delete(token);
      return imported;
    },
    close() {
      db.close();
    },
  };
}
