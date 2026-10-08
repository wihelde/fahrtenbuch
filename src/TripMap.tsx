import { useEffect, useRef, useState } from "react";
import {
  divIcon,
  latLngBounds,
  map as createMap,
  marker,
  polyline,
  tileLayer,
  type Map,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import { routeResultSchema, type RouteResult, type Trip } from "./model";

const routeNumber = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const differenceNumber = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

/** Export endpoints stay independent of the optional external map background. */
export function TripMap({ trip }: { trip: Trip }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const [tileError, setTileError] = useState(false);
  const [route, setRoute] = useState<{ key: string; result: RouteResult } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { startLat, startLng, endLat, endLng } = trip;
  const hasEnd = endLat !== null && endLng !== null;
  const routeKey = JSON.stringify([trip.id, startLat, startLng, endLat, endLng, trip.distanceKm]);
  const result = route?.key === routeKey ? route.result : null;
  useEffect(() => {
    if (!container.current) return;
    setTileError(false);
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
    const tiles = tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
      .on("tileerror", () => setTileError(true))
      .addTo(instance);
    const samePoint = startLat === endLat && startLng === endLng;
    const points: { position: [number, number]; label: string; symbol: string; kind: string }[] = [
      {
        position: [startLat, startLng],
        label: samePoint ? "Start und Ziel" : "Start",
        symbol: samePoint ? "S/Z" : "S",
        kind: "start",
      },
    ];
    if (endLat !== null && endLng !== null && !samePoint)
      points.push({ position: [endLat, endLng], label: "Ziel", symbol: "Z", kind: "end" });
    if (points.length === 1) instance.setView(points[0].position, 14);
    else
      instance.fitBounds(latLngBounds(points.map((point) => point.position)), {
        padding: [44, 44],
        maxZoom: 16,
        animate: false,
      });
    for (const point of points) {
      const endpoint = marker(point.position, {
        title: point.label,
        icon: divIcon({
          className: `trip-marker ${point.kind}`,
          html: `<span>${point.symbol}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
      })
        .addTo(instance)
        .bindPopup(point.label);
      endpoint.getElement()?.setAttribute("aria-label", point.label);
    }
    const resize = new ResizeObserver(() => instance.invalidateSize({ animate: false }));
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      tiles.off();
      instance.remove();
      map.current = null;
    };
  }, [startLat, startLng, endLat, endLng]);
  useEffect(() => {
    const controller = new AbortController();
    setRoute(null);
    void fetch(`/api/trips/${trip.id}/route`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Route not available");
        return routeResultSchema.parse(await response.json());
      })
      .then((result) => setRoute({ key: routeKey, result }))
      .catch(() => {
        if (!controller.signal.aborted)
          setRoute({ key: routeKey, result: { status: "unavailable" } });
      });
    return () => controller.abort();
  }, [trip.id, routeKey, attempt]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || result?.status !== "ready") return;
    const points = result.geometry.coordinates.map(([lng, lat]): [number, number] => [lat, lng]);
    const line = polyline(points, {
      color: "#234fbc",
      weight: 4,
      opacity: 0.85,
      interactive: false,
    }).addTo(instance);
    // Route shape can extend beyond both exported endpoints; keep all three visible.
    instance.fitBounds(
      latLngBounds([
        ...points,
        [startLat, startLng],
        ...(hasEnd ? [[endLat!, endLng!] as [number, number]] : []),
      ]),
      { padding: [44, 44], maxZoom: 16, animate: false },
    );
    return () => {
      line.remove();
    };
  }, [result, startLat, startLng, endLat, endLng, hasEnd]);
  return (
    <section className="trip-map-section" aria-labelledby="trip-map-title">
      <header className="trip-map-header">
        <h3 id="trip-map-title">Start und Ziel</h3>
        <div className="map-zoom" role="group" aria-label="Kartenzoom">
          <button
            className="button secondary"
            type="button"
            aria-label="Karte vergrößern"
            onClick={() => map.current?.zoomIn()}
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            className="button secondary"
            type="button"
            aria-label="Karte verkleinern"
            onClick={() => map.current?.zoomOut()}
          >
            <span aria-hidden="true">−</span>
          </button>
        </div>
      </header>
      <div
        ref={container}
        className="trip-map"
        role="region"
        aria-label="Karte mit Start und Ziel"
        aria-describedby="map-help"
      />
      <p id="map-help" className="map-help">
        S: Start · Z: Ziel. Karte mit Pfeiltasten bewegen.
      </p>
      {tileError && (
        <p className="detail-note" role="status">
          Kartenhintergrund konnte nicht vollständig geladen werden. Koordinaten und Fahrtdaten
          bleiben verfügbar.
        </p>
      )}
      {!hasEnd && (
        <p className="detail-note">Kein Ziel im Export. Die Karte zeigt nur den Start.</p>
      )}
      <section className="trip-route" aria-labelledby="route-title">
        <h3 id="route-title">Rekonstruierte Route</h3>
        {!result && (
          <p className="detail-note" role="status">
            Route wird geprüft…
          </p>
        )}
        {result?.status === "ready" && (
          <>
            <dl className="route-values">
              <div>
                <dt>Routingentfernung</dt>
                <dd>{routeNumber.format(result.distanceKm)} km</dd>
              </div>
              <div>
                <dt>Abweichung zum Export</dt>
                <dd>{differenceNumber.format(result.differenceKm)} km</dd>
              </div>
              <div>
                <dt>Entfernung laut MyPeugeot</dt>
                <dd>{routeNumber.format(trip.distanceKm)} km</dd>
              </div>
            </dl>
            <p className="detail-note">Plausible Straßenroute, kein aufgezeichneter GPS-Verlauf.</p>
          </>
        )}
        {result?.status === "round-trip" && (
          <p className="detail-note">Rundfahrt: Route aus Start und Ziel nicht rekonstruierbar.</p>
        )}
        {result?.status === "missing-target" && (
          <p className="detail-note">Ohne Ziel lässt sich keine Route rekonstruieren.</p>
        )}
        {result?.status === "unavailable" && (
          <div className="route-failure" role="status">
            <p className="detail-note">
              Route konnte nicht rekonstruiert werden. Start, Ziel und Fahrtdaten bleiben verfügbar.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => setAttempt(attempt + 1)}
            >
              Route erneut laden
            </button>
          </div>
        )}
        <p className="route-attribution">
          Routing: <a href="https://project-osrm.org/">OSRM</a> ·{" "}
          <a href="https://routing.openstreetmap.de/about.html">FOSSGIS</a> · Kartendaten ©{" "}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ·{" "}
          <a href="https://www.openstreetmap.org/fixthemap">Kartenfehler melden</a>
        </p>
      </section>
    </section>
  );
}
