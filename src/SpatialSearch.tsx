import { useEffect, useRef, useState } from "react";
import { circle, circleMarker, map as createMap, tileLayer, type Map } from "leaflet";
import "leaflet/dist/leaflet.css";

export type Nearby = { lat: number; lng: number; radiusKm: number };
const coordinates = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 5 });

/** Select an endpoint neighbourhood by touch, pointer or keyboard, without geocoding. */
export function SpatialSearch({
  value,
  initialPoint,
  onChange,
  disabled,
  applied,
}: {
  value: Nearby | null;
  initialPoint: [number, number];
  onChange: (value: Nearby | null) => void;
  disabled: boolean;
  applied: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [radius, setRadius] = useState("5");
  useEffect(() => {
    setRadius(String(value?.radiusKm ?? 5));
  }, [value?.radiusKm]);
  return (
    <details className="spatial-search" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Ortssuche{value ? " · Punkt gewählt" : ""}</summary>
      {open && (
        <>
          <SearchMap
            value={value}
            initialPoint={initialPoint}
            onSelect={(lat, lng) =>
              onChange({ lat, lng, radiusKm: Number(radius) > 0 ? Number(radius) : 5 })
            }
          />
          <div className="spatial-controls">
            <label>
              Radius in km
              <input
                type="number"
                min="0.01"
                step="any"
                required={Boolean(value)}
                disabled={disabled}
                value={radius}
                onChange={(event) => {
                  setRadius(event.target.value);
                  const radiusKm = Number(event.target.value);
                  if (value && Number.isFinite(radiusKm) && radiusKm > 0)
                    onChange({ ...value, radiusKm });
                }}
              />
            </label>
            <button
              type="submit"
              className="button primary"
              disabled={disabled || (!value && !applied)}
            >
              Filter anwenden
            </button>
            {value && (
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => onChange(null)}
              >
                Punkt entfernen
              </button>
            )}
          </div>
          <p className="map-help" role="status">
            {value
              ? `Punkt: ${coordinates.format(value.lat)}°, ${coordinates.format(value.lng)}°. Anwenden aktualisiert die Auswahl.`
              : "Wähle einen Punkt. Es zählen nur Start und Ziel, keine Durchfahrten."}
          </p>
        </>
      )}
    </details>
  );
}

function SearchMap({
  value,
  initialPoint,
  onSelect,
}: {
  value: Nearby | null;
  initialPoint: [number, number];
  onSelect: (lat: number, lng: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [tileError, setTileError] = useState(false);
  // Keep the viewport stable while draft coordinates and radius update their own layers.
  useEffect(() => {
    if (!container.current) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const instance = createMap(container.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: !reducedMotion,
    });
    map.current = instance;
    instance.attributionControl.setPrefix(false);
    instance.setView(value ? [value.lat, value.lng] : initialPoint, 11);
    const tiles = tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
      .on("tileerror", () => setTileError(true))
      .addTo(instance);
    const choose = (lat: number, lng: number) => {
      const point = instance.wrapLatLng([Math.max(-90, Math.min(90, lat)), lng]);
      select.current(point.lat, point.lng);
    };
    instance.on("click", (event) => choose(event.latlng.lat, event.latlng.lng));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Enter" && event.target === container.current) {
        event.preventDefault();
        const center = instance.getCenter();
        choose(center.lat, center.lng);
      }
    };
    container.current.addEventListener("keydown", keyboard);
    const element = container.current;
    const resize = new ResizeObserver(() => instance.invalidateSize({ animate: false }));
    resize.observe(element);
    return () => {
      resize.disconnect();
      element.removeEventListener("keydown", keyboard);
      tiles.off();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !value) return;
    const point: [number, number] = [value.lat, value.lng];
    const range = circle(point, {
      radius: value.radiusKm * 1000,
      color: "#234fbc",
      weight: 2,
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(instance);
    const center = circleMarker(point, {
      radius: 6,
      color: "white",
      weight: 2,
      fillColor: "#234fbc",
      fillOpacity: 1,
      interactive: false,
    }).addTo(instance);
    return () => {
      range.remove();
      center.remove();
    };
  }, [value]);
  return (
    <>
      <header className="trip-map-header">
        <h2>Punkt wählen</h2>
        <div className="map-zoom" role="group" aria-label="Ortssuche Kartenzoom">
          <button
            type="button"
            className="button secondary"
            aria-label="Suchkarte vergrößern"
            onClick={() => map.current?.zoomIn()}
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            type="button"
            className="button secondary"
            aria-label="Suchkarte verkleinern"
            onClick={() => map.current?.zoomOut()}
          >
            <span aria-hidden="true">−</span>
          </button>
        </div>
      </header>
      <div className="search-map-frame">
        <div
          ref={container}
          className="trip-map"
          role="region"
          aria-label="Karte für die Ortssuche"
          aria-describedby="spatial-map-help"
        />
        <span className="map-crosshair" aria-hidden="true">
          +
        </span>
      </div>
      <p id="spatial-map-help" className="map-help">
        Karte antippen oder mit Pfeiltasten verschieben und Enter drücken. Das Kreuz markiert die
        Kartenmitte.
      </p>
      {tileError && (
        <p className="detail-note" role="status">
          Kartenhintergrund konnte nicht vollständig geladen werden. Punktwahl und Ortssuche bleiben
          verfügbar.
        </p>
      )}
    </>
  );
}
