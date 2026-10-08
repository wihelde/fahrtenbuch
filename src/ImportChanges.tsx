import { useEffect, useRef } from "react";
import type { ImportPreview, TripValues } from "./model";

const numbers = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 20 });
const labels: Record<keyof TripValues, string> = {
  date: "Datum laut Export",
  startTime: "Start",
  arrivalTime: "Ankunft",
  durationMinutes: "Dauer",
  startLat: "Start: Breitengrad",
  startLng: "Start: Längengrad",
  endLat: "Ziel: Breitengrad",
  endLng: "Ziel: Längengrad",
  distanceKm: "Entfernung",
  odometerKm: "Kilometerstand",
  consumption: "Verbrauch",
  fuelPrice: "Kraftstoffpreis",
  cost: "Kosten",
  category: "Kategorie",
};
function value(field: keyof TripValues, v: TripValues[keyof TripValues]) {
  if (v === null) return "Keine Angabe";
  if (typeof v !== "number") return v;
  const units: Partial<Record<keyof TripValues, string>> = {
    distanceKm: " km",
    odometerKm: " km",
    consumption: " l/100 km",
    fuelPrice: " €/l",
    cost: " €",
    durationMinutes: " min",
  };
  return numbers.format(v) + (units[field] ?? "");
}

/** Show the exact imported fields being replaced before the user chooses an outcome. */
export function ImportChanges({
  preview,
  saving,
  confirm,
  cancel,
}: {
  preview: ImportPreview;
  saving: boolean;
  confirm: (applyChanges: boolean) => void;
  cancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="import-changes" aria-labelledby="changes-title">
      <div className="changes-heading">
        <div>
          <p className="context">Wiederimport prüfen</p>
          <h2 id="changes-title" ref={heading} tabIndex={-1}>
            {numbers.format(preview.changedCount)}{" "}
            {preview.changedCount === 1 ? "bekannte Fahrt verändert" : "bekannte Fahrten verändert"}
          </h2>
        </div>
        <button className="text-button" onClick={cancel} disabled={saving}>
          Abbrechen
        </button>
      </div>
      <p className="changes-summary">
        {numbers.format(preview.newCount)} neue · {numbers.format(preview.unchangedCount)}{" "}
        unveränderte · {numbers.format(preview.errorCount)} fehlerhafte Zeilen
      </p>
      <p className="import-note">
        Bisherige Werte bleiben erhalten, bis du die Änderungen übernimmst. Die Originaldatei wird
        beim Abschluss unverändert archiviert.
      </p>
      <div className="changes-list">
        {preview.changes.map((change, index) => (
          <details key={change.id} open={index === 0}>
            <summary>
              {change.before.date.split("-").reverse().join(".")} · {change.before.startTime} ·{" "}
              {numbers.format(change.before.odometerKm)} km{" "}
              <span>{change.fields.length} Änderungen</span>
            </summary>
            <table className="changes-table">
              <caption className="sr-only">Geänderte Importwerte dieser Fahrt</caption>
              <thead>
                <tr>
                  <th scope="col">Angabe</th>
                  <th scope="col">Bisher</th>
                  <th scope="col">Im neuen Export</th>
                </tr>
              </thead>
              <tbody>
                {change.fields.map((field) => (
                  <tr key={field}>
                    <th scope="row">{labels[field]}</th>
                    <td>{value(field, change.before[field])}</td>
                    <td>{value(field, change.after[field])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
      {preview.errorCount > 0 && (
        <details className="import-errors">
          <summary>Fehler ansehen ({numbers.format(preview.errorCount)})</summary>
          <ul>
            {preview.errors.map((error) => (
              <li key={error.line}>
                <strong>
                  Zeile {error.line} · {error.field}
                </strong>
                <span>{error.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="changes-actions">
        <button className="button primary" onClick={() => confirm(true)} disabled={saving}>
          {saving
            ? "Wird gespeichert…"
            : preview.newCount
              ? "Neue Fahrten und Änderungen übernehmen"
              : "Änderungen übernehmen"}
        </button>
        <button className="button secondary" onClick={() => confirm(false)} disabled={saving}>
          Bisherige Werte behalten
        </button>
      </div>
      <p className="import-note">
        „Bisherige Werte behalten“ ergänzt nur neue Fahrten und überspringt alle Änderungen
        bekannter Fahrten.
      </p>
    </section>
  );
}
