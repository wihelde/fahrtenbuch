import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import {
  archiveSchema,
  filtersSchema,
  analysisSchema,
  type Analysis,
  importSchema,
  importResultSchema,
  importPreviewSchema,
  type ImportPreview,
  type Import,
  type ImportResult,
  type Trip,
  type TripFilters,
} from "./model";
import { SpatialSearch, type Nearby } from "./SpatialSearch";
import { TripDetail } from "./TripDetail";
import { Summary } from "./Summary";
import { Developments } from "./Developments";
import { ThemeControl } from "./ThemeControl";
import { periodPresets, periodRange, type ComparisonMode } from "./periods";

import { ImportChanges } from "./ImportChanges";

const numbers = new Intl.NumberFormat("de-DE");
const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const radiusFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 });
const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" });
const historySchema = z.object({ imports: z.array(importSchema) });
const pageSize = 50;
const sortColumns = [
  { field: "date", label: "Datum" },
  { field: "startTime", label: "Start" },
  { field: "arrivalTime", label: "Ankunft" },
  { field: "durationMinutes", label: "Dauer", numeric: true },
  { field: "distanceKm", label: "Entfernung", numeric: true },
  { field: "consumption", label: "Verbrauch", numeric: true },
  { field: "cost", label: "Kosten", numeric: true },
  { field: "category", label: "Kategorie" },
] as const;
type SortField = (typeof sortColumns)[number]["field"];

function date(value: string) {
  return new Date(`${value}T12:00:00Z`);
}
function duration(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function Icon({ name }: { name: "archive" | "upload" | "check" | "arrow" | "file" }) {
  const paths = {
    archive: (
      <>
        <path d="M6 19V8a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0v-5" />
        <circle cx="6" cy="19" r="1" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-4 4 4-4 4 4M5 16v4h14v-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    file: (
      <>
        <path d="M14 3H6v18h12V7l-4-4Zm0 0v5h4M9 12h6m-6 4h6" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

async function response<T>(result: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await result.json();
  if (!result.ok) {
    const message = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      message.success ? message.data.error : "Die Anfrage konnte nicht abgeschlossen werden.",
    );
  }
  return schema.parse(body);
}

async function readSelection(filters: TripFilters = {}, compare: ComparisonMode | "" = "") {
  const query = new URLSearchParams(
    Object.entries(filters).map(([key, value]) => [key, String(value)]),
  );
  const [archive, analysis] = await Promise.all([
    fetch(`/api/trips?${query}`).then((r) => response(r, archiveSchema)),
    fetch(`/api/analysis?${query}${compare ? `&compare=${compare}` : ""}`).then((r) =>
      response(r, analysisSchema),
    ),
  ]);
  return { trips: archive.trips, analysis };
}

async function readArchive() {
  const [selection, history] = await Promise.all([
    readSelection(),
    fetch("/api/imports").then((r) => response(r, historySchema)),
  ]);
  return { ...selection, imports: history.imports };
}

function Values({ trip }: { trip: Trip }) {
  const values: [string, ReactNode][] = [
    ["Start", trip.startTime],
    [
      "Ankunft",
      <>
        {trip.arrivalTime}
        {trip.arrivalTime < trip.startTime && (
          <span className="overnight" title="Über Mitternacht. Datum laut Export.">
            {" "}
            ↗<span className="sr-only"> über Mitternacht</span>
          </span>
        )}
      </>,
    ],
    ["Dauer", `${duration(trip.durationMinutes)} h`],
    ["Entfernung", `${decimal.format(trip.distanceKm)} km`],
    [
      "Verbrauch",
      trip.consumption === null ? "Keine Angabe" : `${decimal.format(trip.consumption)} l/100 km`,
    ],
    ["Kosten", trip.cost === null ? "Keine Angabe" : money.format(trip.cost)],
  ];
  return (
    <dl className="mobile-values">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function App() {
  const [archive, setArchive] = useState<{ trips: Trip[]; imports: Import[] }>({
    trips: [],
    imports: [],
  });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "date",
    direction: "desc",
  });
  const [initialRange] = useState(() => periodRange("30"));
  const [filterDraft, setFilterDraft] = useState({ ...initialRange, category: "", missing: "" });
  const [preset, setPreset] = useState("30");
  const [comparison, setComparison] = useState<ComparisonMode | "">("");
  const [spatialDraft, setSpatialDraft] = useState<Nearby | null>(null);
  const [filters, setFilters] = useState<TripFilters>(initialRange);
  const [filteredTrips, setFilteredTrips] = useState<Trip[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const closeDetail = useCallback(() => setSelectedTrip(null), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const firstLoad = useRef(true);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const loaded = await readArchive();
      const filtering = Object.keys(filters).length > 0;
      const selection = filtering ? await readSelection(filters, comparison) : loaded;
      setFilteredTrips(filtering ? selection.trips : null);
      setAnalysis(selection.analysis);
      setArchive(loaded);
      setPage((current) =>
        Math.min(current, Math.max(0, Math.ceil(selection.trips.length / pageSize) - 1)),
      );
    } catch {
      setError("Das Archiv ist gerade nicht erreichbar. Bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      void reload();
    }
  }, []);

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    setImported(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const saved = await fetch("/api/imports", { method: "POST", body: form }).then((r) =>
        response(r, z.union([importResultSchema, importPreviewSchema])),
      );
      if ("token" in saved) setPreview(saved);
      else setImported(saved);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setShowUpload(false);
      setPage(0);
      if (!("token" in saved)) await reload();
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Der Server ist nicht erreichbar. Bitte erneut versuchen."
          : cause instanceof Error
            ? cause.message
            : "Der Import konnte nicht abgeschlossen werden.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function confirmImport(applyChanges: boolean) {
    if (!preview || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const result = await fetch(`/api/imports/${preview.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyChanges }),
      });
      if (result.status === 409) setPreview(null);
      const saved = await response(result, importResultSchema);
      setImported(saved);
      setPreview(null);
      setPage(0);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Die Änderungen konnten nicht übernommen werden.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function applyFilters(
    event?: FormEvent<HTMLFormElement>,
    reset = false,
    choice?: {
      draft?: typeof filterDraft;
      preset?: string;
      comparison?: ComparisonMode | "";
    },
  ) {
    event?.preventDefault();
    if (filterLoading) return;
    setFilterLoading(true);
    setError(null);
    try {
      const next = reset
        ? {}
        : filtersSchema.parse({
            ...Object.fromEntries(
              Object.entries(choice?.draft ?? filterDraft).filter(([, value]) => value),
            ),
            ...spatialDraft,
          });
      const mode = !next.from || !next.to ? "" : (choice?.comparison ?? comparison);
      const filtered = await readSelection(next, mode);
      setFilteredTrips(filtered.trips);
      setAnalysis(filtered.analysis);
      setFilters(next);
      setComparison(mode);
      if (choice?.draft) setFilterDraft(choice.draft);
      if (choice?.preset) setPreset(choice.preset);
      setPage(0);
      if (reset) {
        setFilterDraft({ from: "", to: "", category: "", missing: "" });
        setSpatialDraft(null);
        setPreset("all");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Auswahl konnte nicht geladen werden.");
    } finally {
      setFilterLoading(false);
    }
  }

  const empty = archive.trips.length === 0;
  const activeFilters = Object.keys(filters).length > 0;
  const trips = filteredTrips ?? archive.trips;
  // Sort the entire selection before pagination; absent values stay last in either direction.
  const sortedTrips = [...trips].sort((a, b) => {
    const left = sort.field === "date" ? `${a.date} ${a.startTime}` : a[sort.field];
    const right = sort.field === "date" ? `${b.date} ${b.startTime}` : b[sort.field];
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const difference =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left ?? "").localeCompare(String(right ?? ""), "de");
    const chronological =
      b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime) || b.id - a.id;
    return difference * (sort.direction === "asc" ? 1 : -1) || chronological;
  });
  const rows = sortedTrips.slice(page * pageSize, (page + 1) * pageSize);
  const sortLabel = `${sortColumns.find((column) => column.field === sort.field)!.label} ${sort.direction === "asc" ? "aufsteigend" : "absteigend"}`;
  function changeSort(field: SortField, direction?: "asc" | "desc") {
    setSort({
      field,
      direction: direction ?? (sort.field === field && sort.direction === "asc" ? "desc" : "asc"),
    });
    setPage(0);
  }
  const oldest = archive.trips.at(-1);
  const newest = archive.trips[0];
  const lastImport = archive.imports[0];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Zum Inhalt
      </a>
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="Fahrtenbuch">
          <span className="brand-symbol">
            <Icon name="archive" />
          </span>
          Fahrtenbuch
        </a>
        <div className="header-actions">
          <ThemeControl />
          {!empty && (
            <button
              className="button primary"
              aria-label="CSV importieren"
              type="button"
              onClick={() => {
                setShowUpload(true);
                requestAnimationFrame(() => fileInput.current?.focus());
              }}
              disabled={uploading || loading || Boolean(preview)}
            >
              <Icon name="upload" />
              CSV importieren
            </button>
          )}
        </div>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <header className="page-header">
          <div>
            <h1>Fahrten</h1>
            <p className="subtitle">
              {loading && empty
                ? "Archiv wird geladen…"
                : empty
                  ? "Dein persönlicher Blick auf unterwegs."
                  : `${numbers.format(archive.trips.length)} Fahrten · ${dateFormat.format(date(oldest!.date))} bis ${dateFormat.format(date(newest!.date))}`}
            </p>
          </div>
        </header>

        <div aria-live="polite" aria-atomic="true">
          {imported && (
            <div className={`notice import-result ${imported.errorCount ? "warning" : "success"}`}>
              <Icon name="check" />
              <div>
                <strong>
                  {numbers.format(imported.newCount)}{" "}
                  {imported.newCount === 1 ? "neue Fahrt" : "neue Fahrten"} ·{" "}
                  {numbers.format(imported.appliedCount)}{" "}
                  {imported.appliedCount === 1 ? "Änderung" : "Änderungen"} übernommen
                </strong>
                <p>
                  {imported.errorCount
                    ? `${numbers.format(imported.errorCount)} fehlerhafte Zeilen ausgelassen. `
                    : ""}
                  {numbers.format(imported.unchangedCount)} unveränderte Fahrten übersprungen.{" "}
                  {imported.changedCount > imported.appliedCount
                    ? `${numbers.format(imported.changedCount - imported.appliedCount)} ${imported.changedCount - imported.appliedCount === 1 ? "Änderung" : "Änderungen"} nicht übernommen. `
                    : ""}{" "}
                  Originaldatei unverändert archiviert.
                </p>
                <p className="format-info">
                  {imported.encoding} ·{" "}
                  {imported.delimiter === ";"
                    ? "Semikolon"
                    : imported.delimiter === ","
                      ? "Komma"
                      : "Tabulator"}
                </p>
                {imported.errorCount > 0 && (
                  <details className="import-errors">
                    <summary>Fehler ansehen ({numbers.format(imported.errorCount)})</summary>
                    <p>Zeilen zählen ab der Kopfzeile der Originaldatei.</p>
                    <ul>
                      {imported.errors.map((entry) => (
                        <li key={entry.line}>
                          <strong>
                            Zeile {entry.line} · {entry.field}
                          </strong>
                          <span>{entry.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <button
                className="text-button"
                onClick={() => setImported(null)}
                aria-label="Importmeldung schließen"
              >
                Schließen
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            <div>
              <strong>{error}</strong>
              <p>Deine bereits gespeicherten Fahrten bleiben erhalten.</p>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() => void reload()}
              disabled={uploading}
            >
              Erneut laden
            </button>
          </div>
        )}

        {preview && (
          <ImportChanges
            preview={preview}
            saving={uploading}
            confirm={(apply) => void confirmImport(apply)}
            cancel={() => setPreview(null)}
          />
        )}

        {!preview && !loading && (empty || showUpload) && (
          <section
            className={`import-panel ${empty ? "first-import" : ""}`}
            aria-labelledby="import-title"
          >
            <div className="import-heading">
              <span className="import-icon">
                <Icon name="file" />
              </span>
              <div>
                <h2 id="import-title">{empty ? "Dein erster Import" : "Fahrten hinzufügen"}</h2>
                <p>
                  {empty
                    ? "Wähle deinen CSV-Export aus MyPeugeot aus."
                    : "Wähle einen weiteren MyPeugeot-Export aus."}
                </p>
              </div>
              {!empty && (
                <button
                  className="text-button"
                  disabled={uploading}
                  onClick={() => setShowUpload(false)}
                >
                  Schließen
                </button>
              )}
            </div>
            <form onSubmit={(event) => void importFile(event)}>
              <label className="file-label" htmlFor="csv-file">
                CSV-Datei
                <input
                  ref={fileInput}
                  id="csv-file"
                  name="file"
                  type="file"
                  accept=".csv,text/csv"
                  disabled={uploading}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="button primary" type="submit" disabled={!file || uploading}>
                <Icon name="upload" />
                {uploading ? "Wird importiert…" : "Fahrten importieren"}
              </button>
            </form>
            <p className="import-note">
              Originalwerte bleiben erhalten. Deine CSV wird unverändert archiviert.
            </p>
          </section>
        )}

        {loading && empty && (
          <div className="loading" role="status" aria-label="Fahrten werden geladen">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="skeleton" />
            ))}
          </div>
        )}

        {!empty && (
          <section className="trip-section" aria-labelledby="list-title" aria-busy={filterLoading}>
            <form className="trip-filters" onSubmit={(event) => void applyFilters(event)}>
              <label>
                Zeitraum
                <select
                  value={preset}
                  disabled={filterLoading}
                  onChange={(event) =>
                    void applyFilters(undefined, false, {
                      draft: { ...filterDraft, ...periodRange(event.target.value) },
                      preset: event.target.value,
                    })
                  }
                >
                  <option value="custom" disabled>
                    Eigener Zeitraum
                  </option>
                  {periodPresets.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Von
                <input
                  type="date"
                  value={filterDraft.from}
                  max={filterDraft.to || undefined}
                  disabled={filterLoading}
                  onChange={(event) => {
                    setFilterDraft({ ...filterDraft, from: event.target.value });
                    setPreset("custom");
                  }}
                />
              </label>
              <label>
                Bis
                <input
                  type="date"
                  value={filterDraft.to}
                  min={filterDraft.from || undefined}
                  disabled={filterLoading}
                  onChange={(event) => {
                    setFilterDraft({ ...filterDraft, to: event.target.value });
                    setPreset("custom");
                  }}
                />
              </label>
              <label>
                Kategorie
                <select
                  value={filterDraft.category}
                  disabled={filterLoading}
                  onChange={(event) =>
                    void applyFilters(undefined, false, {
                      draft: { ...filterDraft, category: event.target.value },
                    })
                  }
                >
                  <option value="">Alle Kategorien</option>
                  <option>Freizeit</option>
                  <option>Geschäftlich</option>
                </select>
              </label>
              <label>
                Angaben
                <select
                  name="missing"
                  value={filterDraft.missing}
                  disabled={filterLoading}
                  onChange={(event) =>
                    void applyFilters(undefined, false, {
                      draft: { ...filterDraft, missing: event.target.value },
                    })
                  }
                >
                  <option value="">Alle Angaben</option>
                  <option value="any">Fehlende Angaben</option>
                  <option value="consumption">Verbrauch fehlt</option>
                  <option value="cost">Kosten fehlen</option>
                </select>
              </label>
              <label>
                Vergleichen mit
                <select
                  value={comparison}
                  disabled={filterLoading || !filterDraft.from || !filterDraft.to}
                  onChange={(event) =>
                    void applyFilters(undefined, false, {
                      comparison: event.target.value as ComparisonMode | "",
                    })
                  }
                >
                  <option value="">Kein Vergleich</option>
                  <option value="previous">Vorheriger Zeitraum</option>
                  <option value="year">Vorjahr</option>
                </select>
              </label>
              <button className="button primary" disabled={filterLoading} type="submit">
                {filterLoading ? "Wird geladen…" : "Anwenden"}
              </button>
              <button
                className="text-button"
                disabled={
                  filterLoading ||
                  (!activeFilters && !spatialDraft && !Object.values(filterDraft).some(Boolean))
                }
                type="button"
                onClick={() => void applyFilters(undefined, true)}
              >
                Zurücksetzen
              </button>
              <SpatialSearch
                value={spatialDraft}
                initialPoint={[archive.trips[0]!.startLat, archive.trips[0]!.startLng]}
                onChange={setSpatialDraft}
                disabled={filterLoading}
                applied={filters.radiusKm !== undefined}
              />
            </form>
            <p className="filter-status" role="status">
              {activeFilters
                ? `${numbers.format(trips.length)} Treffer · ${filters.from ? `ab ${dateFormat.format(date(filters.from))}` : "ohne Anfangsdatum"} · ${filters.to ? `bis ${dateFormat.format(date(filters.to))}` : "ohne Enddatum"} · ${filters.category ?? "alle Kategorien"}${filters.radiusKm !== undefined ? ` · Ortssuche: ${radiusFormat.format(filters.radiusKm)} km um ${filters.lat!.toFixed(5)}°, ${filters.lng!.toFixed(5)}° (Start oder Ziel)` : ""}`
                : "Alle Fahrten"}
              {filters.missing &&
                ` · ${filters.missing === "consumption" ? "Verbrauch fehlt" : filters.missing === "cost" ? "Kosten fehlen" : "Verbrauch oder Kosten fehlen"}`}
            </p>
            {analysis && (
              <>
                <Summary analysis={analysis} />
                {analysis.comparison && (
                  <p className="comparison-period" role="status">
                    Vergleich: {dateFormat.format(date(analysis.comparison.from))} bis{" "}
                    {dateFormat.format(date(analysis.comparison.to))}
                  </p>
                )}
                <Developments analysis={analysis} selectionScope={JSON.stringify(filters)} />
              </>
            )}
            <div className="list-heading">
              <h2 id="list-title">{activeFilters ? "Ausgewählte Fahrten" : "Alle Fahrten"}</h2>
              <span className="desktop-sort-status">{sortLabel}</span>
              <div className="mobile-sorting">
                <label>
                  Sortieren nach
                  <select
                    aria-label="Sortieren nach"
                    value={sort.field}
                    onChange={(event) =>
                      changeSort(event.target.value as SortField, sort.direction)
                    }
                  >
                    {sortColumns.map((column) => (
                      <option key={column.field} value={column.field}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  onClick={() => changeSort(sort.field)}
                  aria-label={`Sortierung ${sort.direction === "asc" ? "absteigend" : "aufsteigend"}`}
                >
                  {sort.direction === "asc" ? "Aufsteigend ↑" : "Absteigend ↓"}
                </button>
              </div>
            </div>
            {trips.length === 0 && (
              <div className="filter-empty">
                <h3>Keine Fahrten für diese Auswahl</h3>
                <p>Ändere die Filter oder setze sie zurück.</p>
                <button
                  className="button secondary"
                  onClick={() => void applyFilters(undefined, true)}
                  disabled={filterLoading}
                >
                  Alle Fahrten ansehen
                </button>
              </div>
            )}
            {trips.length > 0 && (
              <>
                <div className="desktop-table">
                  <table>
                    <caption className="sr-only">
                      Importierte Fahrten, {sortLabel}. Datum und Dauer laut Export.
                    </caption>
                    <thead>
                      <tr>
                        {sortColumns.map((column) => (
                          <th
                            key={column.field}
                            scope="col"
                            className={"numeric" in column ? "numeric" : undefined}
                            aria-sort={
                              sort.field === column.field
                                ? sort.direction === "asc"
                                  ? "ascending"
                                  : "descending"
                                : undefined
                            }
                          >
                            <button
                              type="button"
                              className="table-sort"
                              onClick={() => changeSort(column.field)}
                              aria-label={`${column.label} ${sort.field === column.field && sort.direction === "asc" ? "absteigend" : "aufsteigend"} sortieren`}
                            >
                              {column.label}
                              <span aria-hidden="true">
                                {sort.field === column.field
                                  ? sort.direction === "asc"
                                    ? "↑"
                                    : "↓"
                                  : "↕"}
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((trip) => (
                        <tr
                          key={trip.id}
                          className="trip-row"
                          onClick={() => setSelectedTrip(trip.id)}
                        >
                          <td className="date-cell">
                            <button
                              className="trip-open"
                              onClick={() => setSelectedTrip(trip.id)}
                              aria-label={`Fahrt vom ${dateFormat.format(date(trip.date))} um ${trip.startTime} ansehen`}
                            >
                              {dateFormat.format(date(trip.date))}
                            </button>
                            <span>{weekdayFormat.format(date(trip.date))}</span>
                          </td>
                          <td>{trip.startTime}</td>
                          <td>
                            {trip.arrivalTime}
                            {trip.arrivalTime < trip.startTime && (
                              <span
                                className="overnight"
                                title="Über Mitternacht. Datum laut Export."
                              >
                                {" "}
                                ↗<span className="sr-only"> über Mitternacht</span>
                              </span>
                            )}
                          </td>
                          <td className="numeric">
                            {duration(trip.durationMinutes)}
                            <span className="unit"> h</span>
                          </td>
                          <td className="numeric distance">
                            {decimal.format(trip.distanceKm)}
                            <span className="unit"> km</span>
                          </td>
                          <td className="numeric">
                            {trip.consumption === null ? (
                              <span className="missing">Keine Angabe</span>
                            ) : (
                              <>
                                {decimal.format(trip.consumption)}
                                <span className="unit"> l/100 km</span>
                              </>
                            )}
                          </td>
                          <td className="numeric">
                            {trip.cost === null ? (
                              <span className="missing">Keine Angabe</span>
                            ) : (
                              money.format(trip.cost)
                            )}
                          </td>
                          <td>
                            <span className="category">
                              <span
                                className={`category-dot ${trip.category === "Geschäftlich" ? "business" : ""}`}
                                aria-hidden="true"
                              />
                              {trip.category}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="mobile-trips">
                  {rows.map((trip) => (
                    <li key={trip.id}>
                      <div className="mobile-trip-heading">
                        <strong>
                          <button
                            className="trip-open"
                            onClick={() => setSelectedTrip(trip.id)}
                            aria-label={`Fahrt vom ${dateFormat.format(date(trip.date))} um ${trip.startTime} ansehen`}
                          >
                            {dateFormat.format(date(trip.date))}
                          </button>
                          <span>{weekdayFormat.format(date(trip.date))}</span>
                        </strong>
                        <span className="category">
                          <span
                            className={`category-dot ${trip.category === "Geschäftlich" ? "business" : ""}`}
                            aria-hidden="true"
                          />
                          {trip.category}
                        </span>
                      </div>
                      <Values trip={trip} />
                    </li>
                  ))}
                </ul>
                <div className="pagination">
                  <span>
                    {numbers.format(page * pageSize + 1)} bis{" "}
                    {numbers.format(Math.min((page + 1) * pageSize, trips.length))} von{" "}
                    {numbers.format(trips.length)}
                  </span>
                  <div>
                    <button
                      className="button icon-button previous"
                      aria-label="Vorherige Fahrten"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      <Icon name="arrow" />
                    </button>
                    <button
                      className="button icon-button"
                      aria-label="Nächste Fahrten"
                      disabled={(page + 1) * pageSize >= trips.length}
                      onClick={() => setPage(page + 1)}
                    >
                      <Icon name="arrow" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {lastImport && (
          <details className="originals">
            <summary>
              <Icon name="file" />
              <span>Originaldateien</span>
              <span className="original-count">
                {numbers.format(archive.imports.length)} archiviert
              </span>
            </summary>
            <ul>
              {archive.imports.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.filename}</strong>
                    <span>
                      {numbers.format(entry.tripCount)} Fahrten · importiert am{" "}
                      {dateFormat.format(new Date(entry.importedAt))}
                    </span>
                  </div>
                  <a className="button secondary" href={`/api/imports/${entry.id}/file`} download>
                    CSV herunterladen
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
        <footer className="page-footer">
          <span className="local-status">
            <span className="local-dot" aria-hidden="true" />
            Lokal gespeichert
          </span>
          <span>MyPeugeot · Originaldaten</span>
          <span>Datum und Dauer laut Export</span>
        </footer>
      </main>
      {selectedTrip !== null && (
        <TripDetail onChanged={() => void reload()} id={selectedTrip} onClose={closeDetail} />
      )}
    </div>
  );
}
