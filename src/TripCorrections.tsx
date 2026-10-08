import { useEffect, useState, type FormEvent } from "react";
import { tripDetailSchema, type TripDetail, type CorrectionPatch } from "./model";

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 });
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
type Field = keyof TripDetail["corrections"];
type Feedback = { field: Field; message: string; error: boolean };

/** Keep drafts independent so saving one field never discards another field's edits. */
function CorrectionField({
  field,
  detail,
  saving,
  feedback,
  onSave,
}: {
  field: Field;
  detail: TripDetail;
  saving: Field | null;
  feedback: Feedback | null;
  onSave: (patch: CorrectionPatch, message: string) => Promise<TripDetail | null>;
}) {
  const effective = detail.trip[field];
  const [value, setValue] = useState(String(effective ?? ""));
  useEffect(() => setValue(String(effective ?? "")), [effective]);
  const entered = field === "category" ? value : value.trim() === "" ? null : Number(value);
  const changed = entered !== effective;
  const label = {
    category: "Kategorie",
    consumption: "Verbrauch (l/100 km)",
    cost: "Kosten (EUR)",
  }[field];
  const action = {
    category: "Kategorie speichern",
    consumption: "Verbrauch speichern",
    cost: "Kosten speichern",
  }[field];
  const original = detail.base[field];
  const correction = detail.corrections[field];
  const calculated =
    field === "consumption" && effective === null
      ? detail.calculatedConsumption
      : field === "cost"
        ? detail.calculatedCost
        : null;
  const status = feedback?.field === field ? feedback : null;
  async function saveField(patch: CorrectionPatch, message: string) {
    const saved = await onSave(patch, message);
    // Explicit adoption also replaces a draft when the saved number was already identical.
    if (saved) setValue(String(saved.trip[field] ?? ""));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed) return;
    const patch =
      field === "category"
        ? {
            category: {
              value: value === "Geschäftlich" ? ("Geschäftlich" as const) : ("Freizeit" as const),
            },
          }
        : { [field]: { value: value.trim() === "" ? null : Number(value) } };
    void saveField(patch, "Gespeichert.");
  }
  return (
    <form onSubmit={submit}>
      <label htmlFor={`correction-${field}`}>{label}</label>
      <p className="correction-origin">
        Import:{" "}
        {original === null
          ? "Keine Angabe"
          : typeof original === "number"
            ? number.format(original)
            : original}
        {correction !== null ? " · Manuell korrigiert" : " · Importwert wirksam"}
      </p>
      {field === "category" ? (
        <select
          id={`correction-${field}`}
          name={field}
          value={value}
          disabled={saving !== null}
          onChange={(event) => setValue(event.target.value)}
        >
          <option>Freizeit</option>
          <option>Geschäftlich</option>
        </select>
      ) : (
        <input
          id={`correction-${field}`}
          name={field}
          type="number"
          step="any"
          inputMode="decimal"
          value={value}
          disabled={saving !== null}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {calculated !== null && (
        <div className="calculated-value">
          <p>
            <strong>
              Berechnet:{" "}
              {field === "consumption"
                ? `ca. ${decimal.format(calculated)} l/100 km`
                : money.format(calculated)}
            </strong>
          </p>
          <details>
            <summary>Berechnung anzeigen</summary>
            <p>
              {field === "consumption" ? (
                <>
                  {number.format(detail.trip.cost!)} EUR ÷ {number.format(detail.trip.fuelPrice)}{" "}
                  EUR/l ÷ {number.format(detail.trip.distanceKm)} km × 100. Die Ausgangswerte können
                  gerundet sein.
                </>
              ) : (
                <>
                  {number.format(detail.trip.distanceKm)} km ×{" "}
                  {number.format(detail.trip.consumption!)} l/100 km ×{" "}
                  {number.format(detail.trip.fuelPrice)} EUR/l. Übernahme ohne vorherige Rundung.
                </>
              )}
            </p>
          </details>
        </div>
      )}
      {field === "consumption" && effective === null && calculated === null && (
        <p className="correction-hint">
          Keine Berechnung möglich: Kosten, positive Strecke oder positiver Kraftstoffpreis fehlen.
        </p>
      )}
      {field === "cost" && calculated === null && (
        <p className="correction-hint">Keine Kostenberechnung ohne vorhandenen Verbrauch.</p>
      )}
      <div className="correction-actions">
        <button className="button primary" disabled={saving !== null || !changed} type="submit">
          {action}
        </button>
        {calculated !== null && (
          <button
            className="button secondary"
            type="button"
            disabled={saving !== null}
            onClick={() =>
              void saveField(
                { [field]: { calculated: true } },
                "Berechneten Wert übernommen und gespeichert.",
              )
            }
          >
            Übernehmen und speichern
          </button>
        )}
        {correction !== null && (
          <button
            className="text-button"
            disabled={saving !== null}
            type="button"
            onClick={() => void saveField({ [field]: null }, "Importwert wieder wirksam.")}
          >
            Importwert verwenden
          </button>
        )}
      </div>
      {field === "consumption" && (
        <p className="correction-hint">Kosten bleiben bei einer Verbrauchskorrektur unverändert.</p>
      )}
      <p
        className={`correction-feedback${status?.error ? " correction-error" : ""}`}
        role={status?.error ? "alert" : "status"}
      >
        {saving === field ? "Wird gespeichert…" : status?.message}
      </p>
    </form>
  );
}

/** Each correction is independent; calculated proposals require an explicit action. */
export function TripCorrections({
  detail,
  onSaved,
}: {
  detail: TripDetail;
  onSaved: (detail: TripDetail) => void;
}) {
  const [saving, setSaving] = useState<Field | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  async function save(field: Field, patch: CorrectionPatch, message: string) {
    if (saving !== null) return null;
    const opener = document.activeElement;
    setSaving(field);
    setFeedback(null);
    try {
      const response = await fetch(`/api/trips/${detail.trip.id}/corrections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Die Korrektur konnte nicht gespeichert werden.");
      const saved = tripDetailSchema.parse(body);
      onSaved(saved);
      setFeedback({ field, message, error: false });
      // An adopted consumption removes its proposal button; retain keyboard focus without scrolling.
      requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && !opener.isConnected)
          document.getElementById(`correction-${field}`)?.focus({ preventScroll: true });
      });
      return saved;
    } catch (cause) {
      setFeedback({
        field,
        message: cause instanceof Error ? cause.message : "Bitte erneut versuchen.",
        error: true,
      });
      return null;
    } finally {
      setSaving(null);
    }
  }
  return (
    <section className="trip-corrections" aria-labelledby="corrections-title">
      <h3 id="corrections-title">Werte korrigieren</h3>
      <p className="correction-intro">
        Importwerte bleiben erhalten. Leere Zahlenfelder bedeuten keine Angabe.
      </p>
      <div className="correction-fields">
        {(["category", "consumption", "cost"] as const).map((field) => (
          <CorrectionField
            key={field}
            field={field}
            detail={detail}
            saving={saving}
            feedback={feedback}
            onSave={(patch, message) => save(field, patch, message)}
          />
        ))}
      </div>
    </section>
  );
}
