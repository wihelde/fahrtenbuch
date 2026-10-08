import { useEffect, useRef, useState } from "react";
import { TripCorrections } from "./TripCorrections";
import { TripMap } from "./TripMap";
import { tripDetailSchema, type TripDetail as Detail } from "./model";

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 });
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });

/** Native modal semantics keep focus inside the trip and return it to its opener. */
export function TripDetail({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    if (!element) return;
    function cancel(event: Event) {
      event.preventDefault();
      element?.close();
      onClose();
    }
    element.addEventListener("close", onClose);
    element.addEventListener("cancel", cancel);
    element.showModal();
    return () => {
      element.removeEventListener("close", onClose);
      element.removeEventListener("cancel", cancel);
      element.close();
      if (opener instanceof HTMLElement) requestAnimationFrame(() => opener.focus());
    };
  }, [onClose]);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setDetail(null);
    void fetch(`/api/trips/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Diese Fahrt konnte nicht geladen werden.");
        return tripDetailSchema.parse(await response.json());
      })
      .then(setDetail)
      .catch(() => {
        if (!controller.signal.aborted) setError("Diese Fahrt ist gerade nicht erreichbar.");
      });
    return () => controller.abort();
  }, [id, attempt]);

  const trip = detail?.trip;
  const values = trip
    ? [
        ["Datum laut Export", date.format(new Date(`${trip.date}T12:00:00Z`))],
        ["Startzeit", trip.startTime],
        ["Ankunftszeit", trip.arrivalTime],
        [
          "Dauer laut Export",
          `${Math.floor(trip.durationMinutes / 60)}:${String(trip.durationMinutes % 60).padStart(2, "0")} h`,
        ],
        ["Entfernung", `${number.format(trip.distanceKm)} km`],
        ["Kilometerstand", `${number.format(trip.odometerKm)} km`],
        [
          "Verbrauch",
          trip.consumption === null
            ? "Keine Angabe"
            : `${number.format(trip.consumption)} l/100 km`,
        ],
        ["Kraftstoffpreis", `${number.format(trip.fuelPrice)} EUR/l`],
        ["Kosten", trip.cost === null ? "Keine Angabe" : `${number.format(trip.cost)} EUR`],
        ["Kategorie", trip.category],
        ["Start · Breitengrad", number.format(trip.startLat)],
        ["Start · Längengrad", number.format(trip.startLng)],
        ["Ziel · Breitengrad", trip.endLat === null ? "Keine Angabe" : number.format(trip.endLat)],
        ["Ziel · Längengrad", trip.endLng === null ? "Keine Angabe" : number.format(trip.endLng)],
      ]
    : [];
  return (
    <dialog ref={dialog} className="trip-dialog" aria-labelledby="detail-title">
      <header className="detail-header">
        <div>
          <p className="context">Fahrtdetails</p>
          <h2 id="detail-title">
            {trip
              ? `${date.format(new Date(`${trip.date}T12:00:00Z`))} · ${trip.startTime}`
              : "Fahrt ansehen"}
          </h2>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            dialog.current?.close();
            onClose();
          }}
        >
          Schließen
        </button>
      </header>
      {!detail && !error && <p role="status">Fahrt wird geladen…</p>}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={() => setAttempt(attempt + 1)}>
            Erneut laden
          </button>
        </div>
      )}
      {trip && detail && (
        <>
          <p className="detail-provenance">
            Quelle: <strong>{detail.source.import.filename}</strong>
          </p>
          {trip.arrivalTime < trip.startTime && (
            <p className="detail-note">
              Über Mitternacht. Datum und Dauer laut Export. Der Starttag ist nicht gesichert.
            </p>
          )}
          <TripMap trip={trip} />
          <dl className="detail-values">
            {values.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <TripCorrections
            detail={detail}
            onSaved={(saved) => {
              setDetail(saved);
              onChanged();
            }}
          />
          <section className="detail-source" aria-labelledby="source-title">
            <h3 id="source-title">Herkunft</h3>
            <p>{detail.source.import.filename}</p>
            <p className="muted">
              Importiert am {date.format(new Date(detail.source.import.importedAt))}
            </p>
            <a
              className="button secondary"
              href={`/api/imports/${detail.source.import.id}/file`}
              download
            >
              Originaldatei herunterladen
            </a>
            <details className="source-values">
              <summary>Originalwerte laut CSV</summary>
              <dl>
                {Object.entries(detail.source.values).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Keine Angabe"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </section>
        </>
      )}
    </dialog>
  );
}
