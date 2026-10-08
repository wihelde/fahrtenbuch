import { useEffect, useRef, useState } from "react";
import type { Analysis, SummaryAnalysis } from "./model";
import { consumptionNote } from "./Summary";
import { ChartTooltip, type TooltipData } from "./ChartTooltip";
import { OdometerChart } from "./OdometerChart";

const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const monthFormat = new Intl.DateTimeFormat("de-DE", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});
const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-01T12:00:00Z`));
const dateLabel = (date: string) => dateFormat.format(new Date(`${date}T12:00:00Z`));
type Measure = "distanceKm" | "consumption" | "cost";
const display = (value: number | null, field: Measure) =>
  value === null
    ? "Keine Angabe"
    : field === "cost"
      ? money.format(value)
      : `${decimal.format(value)} ${field === "distanceKm" ? "km" : "l/100 km"}`;
type Bucket = SummaryAnalysis & { key: string; sourceFrom?: string; sourceTo?: string };
const bucketValue = (bucket: Bucket | undefined, field: Measure) =>
  bucket ? display(bucket[field], field) : "Keine Fahrten";
const sourceLabel = (bucket: Bucket) =>
  bucket.sourceFrom === bucket.sourceTo
    ? dateLabel(bucket.sourceFrom!)
    : `${dateLabel(bucket.sourceFrom!)} bis ${dateLabel(bucket.sourceTo!)}`;

/** Selection is shared by all measures and resets to the newest bucket for each scope. */
export function Developments({
  analysis,
  selectionScope,
}: {
  analysis: Analysis;
  selectionScope: string;
}) {
  const [daily, setDaily] = useState(false);
  const [selection, setSelection] = useState<{ scope: string; key: string } | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const scope = `${selectionScope}:${daily}`;
  const plots = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<Measure | null>(null);
  const expandedOpen = expanded !== null;
  const [plotWidths, setPlotWidths] = useState({ overview: 300, expanded: 900 });
  const current: Bucket[] = daily
    ? analysis.days.map(({ date, ...values }) => ({ key: date, ...values }))
    : analysis.months.map(({ month, ...values }) => ({ key: month, ...values }));
  const prior: Bucket[] = daily
    ? (analysis.comparison?.days ?? []).map(({ date, ...values }) => ({ key: date, ...values }))
    : (analysis.comparison?.months ?? []).map(({ month, ...values }) => ({
        key: month,
        ...values,
      }));
  const currentByKey = new Map(current.map((bucket) => [bucket.key, bucket]));
  const priorByKey = new Map(prior.map((bucket) => [bucket.key, bucket]));
  const keys = [...new Set([...currentByKey.keys(), ...priorByKey.keys()])].sort();
  const selectedKey =
    selection?.scope === scope && keys.includes(selection.key) ? selection.key : keys.at(-1);
  const selected = selectedKey ? currentByKey.get(selectedKey) : undefined;
  const selectedPrior = selectedKey ? priorByKey.get(selectedKey) : undefined;
  const label = (key: string) => (daily ? dateLabel(key) : monthLabel(key));
  const comparing = !!analysis.comparison;
  const charts = [
    {
      field: "distanceKm",
      title: "Gefahrene Kilometer",
      note: daily ? "Summe je Tag" : "Summe je Monat",
      color: "distance",
    },
    {
      field: "consumption",
      title: "Ø Verbrauch",
      note: "Nach Entfernung gewichtet",
      color: "consumption",
    },
    { field: "cost", title: "Kraftstoffkosten", note: "Summe vorhandener Kosten", color: "cost" },
  ] as const;

  useEffect(() => {
    if (!expandedOpen || !dialog.current) return;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener.current?.focus({ preventScroll: true });
    };
  }, [expandedOpen]);

  useEffect(() => {
    const overview = [...(plots.current?.querySelectorAll<HTMLElement>(".month-bars") ?? [])];
    const large = dialog.current?.querySelector<HTMLElement>(".month-bars");
    const measure = () => {
      const widths = {
        overview: overview[0]?.clientWidth ?? 300,
        expanded: large?.clientWidth ?? 900,
      };
      setPlotWidths((previous) =>
        previous.overview === widths.overview && previous.expanded === widths.expanded
          ? previous
          : widths,
      );
    };
    const observer = new ResizeObserver(measure);
    for (const node of [...overview, ...(large ? [large] : [])]) observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [expanded, scope, keys.length]);

  useEffect(() => {
    const dismiss = () => setTooltip(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const observations = analysis.odometer;

  // Both views use the same values, selection and interactions.
  function renderPlot(chart: (typeof charts)[number], enlarged = false) {
    const { field, title, note, color } = chart;
    const width = enlarged ? plotWidths.expanded : plotWidths.overview;
    const labelCount = Math.max(2, Math.floor(width / 80));
    const labelStep = Math.max(1, Math.ceil(keys.length / labelCount));
    const dense = width / keys.length < 24;
    const values = [...current, ...prior].map((bucket) => bucket[field] ?? 0);
    const maximum = Math.max(0, ...values);
    const minimum = Math.min(0, ...values);
    const range = maximum - minimum;
    const baseline = range > 0 ? (-minimum / range) * 100 : 0;
    return (
      <figure className={`monthly-plot chart-${color}`} key={field}>
        <figcaption>
          <div className="plot-heading">
            <h3>{title}</h3>
            {!enlarged && (
              <button
                type="button"
                className="chart-expand"
                aria-label={`${title} vergrößern`}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setTooltip(null);
                  setExpanded(field);
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
                </svg>
              </button>
            )}
          </div>
          <p>{note}</p>
        </figcaption>
        <div className="chart-selection" aria-live="polite">
          <strong>{bucketValue(selected, field)}</strong>
          <span>{selectedKey ? label(selectedKey) : ""}</span>
          {field === "consumption" && selected && (
            <small>
              {consumptionNote(selected)}
              {selected.missingConsumptionCount
                ? ` · ${selected.missingConsumptionCount} Fahrten ohne Verbrauch`
                : ""}
            </small>
          )}
          {field === "cost" && selected && (
            <small>
              {selected.missingCostCount
                ? `${selected.missingCostCount} ${selected.missingCostCount === 1 ? "Fahrt" : "Fahrten"} ohne Kosten`
                : "Alle Kosten erfasst"}
            </small>
          )}
          {comparing && (
            <small className="chart-comparison">
              Vergleich: {bucketValue(selectedPrior, field)}
              {selectedPrior ? ` · ${sourceLabel(selectedPrior)}` : ""}
            </small>
          )}
        </div>
        <div
          className={`month-bars${comparing ? " comparing" : ""}${dense ? " dense-bars" : ""}`}
          role="group"
          aria-label={`${title} pro ${daily ? "Tag" : "Monat"}`}
        >
          {keys.map((key, index) => {
            const showLabel =
              index === 0 ||
              index === keys.length - 1 ||
              (index % labelStep === 0 && index < keys.length - 1 - labelStep / 2);
            const bucket = currentByKey.get(key);
            const previous = priorByKey.get(key);
            const name = `${label(key)}: ${bucketValue(bucket, field)}${comparing ? `; Vergleich: ${bucketValue(previous, field)}${previous ? ` (${sourceLabel(previous)})` : ""}` : ""}`;
            const id = `${enlarged ? "expanded" : "overview"}:${scope}:${field}:${key}`;
            const show = (element: HTMLButtonElement) =>
              setTooltip({
                id,
                text: `${title}\n${name.replace("; Vergleich:", "\nVergleich:")}`,
                anchor: element.getBoundingClientRect(),
                container: element.closest("dialog") ?? undefined,
              });
            return (
              <button
                key={key}
                type="button"
                className="month-bar"
                aria-pressed={selectedKey === key}
                onClick={() => setSelection({ scope, key })}
                tabIndex={selectedKey === key ? 0 : -1}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowLeft"
                      ? Math.max(0, index - 1)
                      : event.key === "ArrowRight"
                        ? Math.min(keys.length - 1, index + 1)
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? keys.length - 1
                            : undefined;
                  if (next === undefined) return;
                  event.preventDefault();
                  setSelection({ scope, key: keys[next]! });
                  const button = event.currentTarget.parentElement?.children[next];
                  if (button instanceof HTMLElement) button.focus({ preventScroll: true });
                }}
                aria-label={name}
                onMouseEnter={(event) => show(event.currentTarget)}
                onMouseLeave={() => setTooltip(null)}
                onFocus={(event) => show(event.currentTarget)}
                onBlur={() => setTooltip(null)}
                aria-describedby={tooltip?.id === id ? "chart-tooltip" : undefined}
              >
                <span className="bar-track" aria-hidden="true">
                  {minimum < 0 && (
                    <span className="bar-baseline" style={{ bottom: `${baseline}%` }} />
                  )}
                  {[bucket, ...(comparing ? [previous] : [])].map((entry, index) => {
                    const value = entry?.[field];
                    return (
                      <span
                        className={`bar-series ${index ? "prior-series" : "current-series"}`}
                        data-missing={value === null}
                        key={index}
                      >
                        {value !== undefined && value !== null && (
                          <span
                            className={`bar-fill${value < 0 ? " negative" : ""}`}
                            style={{
                              height: `${range > 0 ? (Math.abs(value) / range) * 100 : 0}%`,
                              bottom: `${range > 0 ? ((Math.min(value, 0) - minimum) / range) * 100 : 0}%`,
                            }}
                          />
                        )}
                        {value === null && <span className="bar-missing">k. A.</span>}
                        {value === 0 && (
                          <span
                            className="bar-zero"
                            style={{
                              bottom: `clamp(0.3rem, ${baseline}%, calc(100% - 1rem))`,
                            }}
                          >
                            0
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
                {showLabel && (
                  <span
                    className={`bar-label${index === 0 ? " first-label" : index === keys.length - 1 ? " last-label" : ""}`}
                  >
                    {daily
                      ? shortDateFormat.format(new Date(`${key}T12:00:00Z`))
                      : monthLabel(key)
                          .split(" ")
                          .map((part, index) => <span key={index}>{part}</span>)}
                  </span>
                )}
                {tooltip?.id === id && <ChartTooltip value={tooltip} />}
              </button>
            );
          })}
        </div>
      </figure>
    );
  }

  return (
    <section className="developments" aria-labelledby="developments-title">
      {expanded !== null && (
        <dialog
          ref={dialog}
          className="chart-dialog"
          aria-labelledby="chart-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            setTooltip(null);
            setExpanded(null);
          }}
        >
          <header className="chart-dialog-heading">
            <div>
              <h2 id="chart-dialog-title">Entwicklungen</h2>
              <p>
                {keys[0] ? label(keys[0]) : ""} bis {keys.at(-1) ? label(keys.at(-1)!) : ""}
              </p>
            </div>
            <button
              type="button"
              className="button secondary chart-dialog-close"
              onClick={() => {
                setTooltip(null);
                setExpanded(null);
              }}
            >
              Schließen
            </button>
          </header>
          <div className="chart-dialog-controls">
            <div className="chart-granularity" role="group" aria-label="Kennzahl">
              {charts.map((chart) => (
                <button
                  type="button"
                  key={chart.field}
                  data-measure={chart.field}
                  aria-pressed={expanded === chart.field}
                  onClick={() => {
                    setTooltip(null);
                    setExpanded(chart.field);
                  }}
                >
                  {chart.field === "distanceKm"
                    ? "Kilometer"
                    : chart.field === "consumption"
                      ? "Verbrauch"
                      : "Kosten"}
                </button>
              ))}
            </div>
            <div className="chart-granularity" role="group" aria-label="Diagrammansicht">
              <button
                type="button"
                aria-pressed={!daily}
                onClick={() => {
                  setTooltip(null);
                  setDaily(false);
                }}
              >
                Monatlich
              </button>
              <button
                type="button"
                aria-pressed={daily}
                onClick={() => {
                  setTooltip(null);
                  setDaily(true);
                }}
              >
                Täglich
              </button>
            </div>
          </div>
          {comparing && (
            <p className="chart-legend">
              <span>Kräftig: ausgewählter Zeitraum</span>
              <span>Hell: Vergleichszeitraum</span>
            </p>
          )}
          {renderPlot(
            charts.find((chart) => chart.field === expanded)!,
            true,
          )}
          {keys.length > 1 && (
            <label className="chart-period-picker">
              Zeitpunkt auswählen
              <input
                type="range"
                min={0}
                max={keys.length - 1}
                value={selectedKey ? keys.indexOf(selectedKey) : 0}
                aria-label="Zeitpunkt im Diagramm auswählen"
                aria-valuetext={selectedKey ? label(selectedKey) : ""}
                onChange={(event) => {
                  setTooltip(null);
                  setSelection({ scope, key: keys[Number(event.target.value)]! });
                }}
              />
            </label>
          )}
          <p className="chart-note">
            {daily ? "Tage" : "Monate"} ohne Fahrten{comparing ? " in beiden Zeiträumen" : ""}{" "}
            werden ausgelassen. Schraffiert oder k. A.: keine Angabe.
          </p>
        </dialog>
      )}
      <div className="developments-heading">
        <h2 id="developments-title">Entwicklungen</h2>
        <div className="chart-granularity" role="group" aria-label="Diagrammansicht">
          <button type="button" aria-pressed={!daily} onClick={() => setDaily(false)}>
            Monatlich
          </button>
          <button type="button" aria-pressed={daily} onClick={() => setDaily(true)}>
            Täglich
          </button>
        </div>
      </div>
      {keys.length === 0 ? (
        <p className="chart-empty">
          Keine Fahrten für diese Auswahl. Wähle einen anderen Zeitraum.
        </p>
      ) : (
        <>
          {comparing && (
            <p className="chart-legend">
              <span>Kräftig: ausgewählter Zeitraum</span>
              <span>Hell: Vergleichszeitraum</span>
            </p>
          )}
          <div className="monthly-plots" ref={plots}>
            {charts.map((chart) => renderPlot(chart))}
          </div>
          <p className="chart-note">
            {daily ? "Tage" : "Monate"} ohne Fahrten{comparing ? " in beiden Zeiträumen" : ""}{" "}
            werden ausgelassen. Schraffiert oder k. A.: keine Angabe.
            {comparing && " Ein leerer Platz bedeutet keine Fahrten."}
            {[...current, ...prior].some(
              (bucket) => (bucket.consumption ?? 0) < 0 || (bucket.cost ?? 0) < 0,
            ) && " Negative Werte liegen unter der Nulllinie."}
          </p>
          <details className="chart-data">
            <summary>{daily ? "Tageswerte" : "Monatswerte"} als Tabelle</summary>
            <div className="chart-table-scroll">
              <table>
                <caption className="sr-only">Werte der ausgewählten Zeiträume</caption>
                <thead>
                  <tr>
                    <th scope="col">{daily ? "Tag" : "Monat"}</th>
                    {comparing && <th scope="col">Zeitraum</th>}
                    <th scope="col">Kilometer</th>
                    <th scope="col">Ø Verbrauch</th>
                    <th scope="col">Verbrauchsabdeckung</th>
                    <th scope="col">Kosten</th>
                    <th scope="col">Fehlende Kosten</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.flatMap((key) =>
                    [currentByKey.get(key), ...(comparing ? [priorByKey.get(key)] : [])].map(
                      (bucket, index) => (
                        <tr key={`${key}:${index}`}>
                          <th scope="row">{index && bucket ? sourceLabel(bucket) : label(key)}</th>
                          {comparing && <td>{index ? "Vergleich" : "Auswahl"}</td>}
                          <td>{bucketValue(bucket, "distanceKm")}</td>
                          <td>{bucketValue(bucket, "consumption")}</td>
                          <td>{bucket ? consumptionNote(bucket) : "Keine Fahrten"}</td>
                          <td>{bucketValue(bucket, "cost")}</td>
                          <td>{bucket ? `${bucket.missingCostCount} Fahrten` : "Keine Fahrten"}</td>
                        </tr>
                      ),
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </details>
          {observations.length > 0 && (
            <>
              <OdometerChart observations={observations} selectionScope={selectionScope} />
              <details className="chart-data">
                <summary>Kilometerstände als Tabelle</summary>
                <div className="chart-table-scroll">
                  <table>
                    <caption className="sr-only">
                      Exportierte Kilometerstände in chronologischer Reihenfolge
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Datum laut Export</th>
                        <th scope="col">Start</th>
                        <th scope="col">Kilometerstand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {observations.map((point) => (
                        <tr key={point.id}>
                          <td>{dateLabel(point.date)}</td>
                          <td>{point.startTime}</td>
                          <td>{decimal.format(point.odometerKm)} km</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
