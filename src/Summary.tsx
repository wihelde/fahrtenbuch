import type { Analysis, SummaryAnalysis } from "./model";

const number = new Intl.NumberFormat("de-DE");
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const percent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const change = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

function Comparison({
  analysis,
  field,
}: {
  analysis: Analysis;
  field: "count" | "distanceKm" | "consumption" | "cost";
}) {
  const prior = analysis.comparison;
  if (!prior) return null;
  if (!prior.count) return <dd className="measure-comparison">Keine Fahrten im Vergleich</dd>;
  const value = prior[field];
  const current = analysis[field];
  const format = (value: number) =>
    field === "cost"
      ? money.format(value)
      : field === "count"
        ? number.format(value)
        : `${decimal.format(value)} ${field === "consumption" ? "l/100 km" : "km"}`;
  const unit =
    field === "cost"
      ? "€"
      : field === "distanceKm"
        ? "km"
        : field === "consumption"
          ? "l/100 km"
          : "Fahrten";
  return (
    <dd className="measure-comparison">
      <span>Vergleich: {value === null ? "Keine Angabe" : format(value)}</span>
      {value !== null && current !== null && analysis.count > 0 && (
        <span className="measure-change">
          {change.format(current - value)} {unit}
          {field !== "consumption" && value > 0 && current >= 0
            ? ` (${change.format(((current - value) / value) * 100)} %)`
            : ""}
        </span>
      )}
      {field === "consumption" && prior.missingConsumptionCount > 0 && (
        <span>{prior.missingConsumptionCount} Fahrten ohne Verbrauch</span>
      )}
      {field === "cost" && prior.missingCostCount > 0 && (
        <span>{prior.missingCostCount} Fahrten ohne Kosten</span>
      )}
    </dd>
  );
}

export function consumptionNote(analysis: SummaryAnalysis) {
  return analysis.consumptionCoverage === null
    ? "Keine auswertbare Strecke"
    : `Verbrauch für ${percent.format(analysis.consumptionCoverage)} der Strecke vorhanden`;
}

/** Keep completeness next to the measure whose interpretation it affects. */
export function Summary({ analysis }: { analysis: Analysis }) {
  const missing = (count: number) =>
    `${number.format(count)} ${count === 1 ? "Fahrt" : "Fahrten"} ohne Angabe`;
  return (
    <section className="archive-summary" aria-label="Kennzahlen der ausgewählten Fahrten">
      <dl>
        <div>
          <dt>Fahrten</dt>
          <dd>{number.format(analysis.count)}</dd>
          <Comparison analysis={analysis} field="count" />
        </div>
        <div>
          <dt>Entfernung</dt>
          <dd>
            {decimal.format(analysis.distanceKm)} <span>km</span>
          </dd>
          <Comparison analysis={analysis} field="distanceKm" />
        </div>
        <div>
          <dt>Ø Verbrauch</dt>
          <dd>
            {analysis.consumption === null ? (
              "Keine Angabe"
            ) : (
              <>
                {decimal.format(analysis.consumption)} <span>l/100 km</span>
              </>
            )}
          </dd>
          <dd className="measure-note">
            <p>Nach Entfernung gewichtet</p>
            <p>{consumptionNote(analysis)}</p>
            {analysis.missingConsumptionCount > 0 && (
              <p>{missing(analysis.missingConsumptionCount)}</p>
            )}
          </dd>
          <Comparison analysis={analysis} field="consumption" />
        </div>
        <div>
          <dt>Kraftstoffkosten</dt>
          <dd>{analysis.cost === null ? "Keine Angabe" : money.format(analysis.cost)}</dd>
          <dd className="measure-note">
            {analysis.missingCostCount > 0
              ? missing(analysis.missingCostCount)
              : analysis.count > 0
                ? "Alle Fahrten erfasst"
                : "Keine Fahrten ausgewählt"}
          </dd>
          <Comparison analysis={analysis} field="cost" />
        </div>
      </dl>
    </section>
  );
}
