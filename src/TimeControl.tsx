import { useRef, useState, type FormEvent } from "react";
import { timeZoneSchema } from "./model";

/** Keep the display preference in this browser, independent of imported data. */
export function readTimeZone() {
  try {
    const saved = timeZoneSchema.safeParse(localStorage.getItem("fahrtenbuch:timeZone"));
    return saved.success ? saved.data : undefined;
  } catch {
    return undefined;
  }
}

export function TimeControl({
  timeZone,
  disabled,
  onChange,
}: {
  timeZone?: string;
  disabled: boolean;
  onChange: (timeZone?: string) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [utc, setUtc] = useState(Boolean(timeZone));
  const [zone, setZone] = useState(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = timeZoneSchema.safeParse(zone.trim());
    if (utc && !parsed.success) {
      setError("Bitte eine gültige Zeitzone wählen, zum Beispiel Europe/Berlin.");
      return;
    }
    setError(null);
    setSaving(true);
    const next = utc && parsed.success ? parsed.data : undefined;
    const applied = await onChange(next);
    setSaving(false);
    if (!applied) {
      setError("Die Einstellung konnte nicht geladen werden. Bitte erneut versuchen.");
      return;
    }
    try {
      if (next) localStorage.setItem("fahrtenbuch:timeZone", next);
      else localStorage.removeItem("fahrtenbuch:timeZone");
    } catch {
      /* The selection remains usable when browser storage is unavailable. */
    }
    dialog.current?.close();
  }
  return (
    <>
      <button
        type="button"
        className="theme-control"
        aria-label="Zeitzone einstellen"
        title={timeZone ? `Uhrzeiten: UTC → ${timeZone}` : "Uhrzeiten laut Export"}
        disabled={disabled}
        onClick={() => {
          setUtc(Boolean(timeZone));
          setZone(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
          setError(null);
          dialog.current?.showModal();
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        className="trip-dialog time-dialog"
        aria-labelledby="time-title"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <header className="detail-header">
          <h2 id="time-title">Uhrzeiten</h2>
          <button
            type="button"
            className="text-button"
            disabled={saving}
            onClick={() => dialog.current?.close()}
          >
            Schließen
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Exportzeiten
            <select
              value={utc ? "utc" : "export"}
              disabled={saving}
              onChange={(event) => {
                setUtc(event.target.value === "utc");
                setError(null);
              }}
            >
              <option value="export">Unverändert anzeigen</option>
              <option value="utc">UTC in Ortszeit umrechnen</option>
            </select>
          </label>
          {utc && (
            <label>
              Anzeigezeitzone
              <input
                list="time-zones"
                value={zone}
                disabled={saving}
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "time-error" : undefined}
                onChange={(event) => {
                  setZone(event.target.value);
                  setError(null);
                }}
              />
              <datalist id="time-zones">
                {Intl.supportedValuesOf("timeZone").map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
          )}
          <p className="muted">
            {utc
              ? "Sommerzeit, Winterzeit und Datumswechsel werden berücksichtigt. Das Exportdatum gilt als Starttag."
              : "Datum und Uhrzeiten bleiben wie in der CSV."}{" "}
            Originalwerte bleiben erhalten. Gilt für alle Fahrten in diesem Browser.
          </p>
          {error && (
            <p id="time-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" type="submit" disabled={saving}>
            {saving ? "Wird geladen…" : "Übernehmen"}
          </button>
        </form>
      </dialog>
    </>
  );
}
