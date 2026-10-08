import { endpointDistanceMeters } from "./geography";
import { z } from "zod";
import { routeGeometrySchema, type ReconstructedRoute, type RouteResult, type Trip } from "./model";
import type { openArchive } from "./archive";

const responseSchema = z.object({
  code: z.literal("Ok"),
  routes: z
    .array(z.object({ distance: z.number().nonnegative(), geometry: routeGeometrySchema }))
    .min(1),
});

/** OSRM geometry remains separate from the distance reported by MyPeugeot. */
export function createRouting(archive: ReturnType<typeof openArchive>) {
  const base = (process.env.OSRM_URL ?? "https://routing.openstreetmap.de/routed-car").replace(
    /\/$/,
    "",
  );
  const timeoutMs = z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .parse(process.env.OSRM_TIMEOUT_MS ?? 5000);
  const pending = new Map<string, Promise<ReconstructedRoute>>();
  let lastStarted = 0;
  let slots = Promise.resolve();
  async function reconstruct(coordinates: string) {
    // Reserve start slots across all trips without duplicating identical in-flight routes.
    const slot = slots.then(async () => {
      const wait = Math.max(0, 1000 - (Date.now() - lastStarted));
      if (wait) await Bun.sleep(wait);
      lastStarted = Date.now();
    });
    slots = slot;
    await slot;
    const response = await fetch(
      `${base}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      {
        headers: { "User-Agent": "Fahrtenarchiv/1.0 (private self-hosted MyPeugeot archive)" },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) throw new Error("Routing service returned an HTTP error");
    const route = responseSchema.parse(await response.json()).routes[0];
    const reconstructed = { distanceKm: route.distance / 1000, geometry: route.geometry };
    archive.saveRoute(coordinates, reconstructed);
    return reconstructed;
  }
  return {
    async route(trip: Trip): Promise<RouteResult> {
      if (trip.endLat === null || trip.endLng === null) return { status: "missing-target" };
      if (
        (trip.startLat === trip.endLat && trip.startLng === trip.endLng) ||
        (trip.distanceKm > 1 &&
          endpointDistanceMeters(trip.startLat, trip.startLng, trip.endLat, trip.endLng) <= 100)
      )
        return { status: "round-trip" };
      const coordinates = `${trip.startLng},${trip.startLat};${trip.endLng},${trip.endLat}`;
      const cached = archive.cachedRoute(coordinates);
      if (cached)
        return { status: "ready", ...cached, differenceKm: cached.distanceKm - trip.distanceKm };
      let request = pending.get(coordinates);
      if (!request) {
        request = reconstruct(coordinates).finally(() => pending.delete(coordinates));
        pending.set(coordinates, request);
      }
      try {
        const route = await request;
        return { status: "ready", ...route, differenceKm: route.distanceKm - trip.distanceKm };
      } catch {
        console.warn(
          JSON.stringify({ level: "warn", event: "routing_failed", reason: "service_or_response" }),
        );
        return { status: "unavailable" };
      }
    },
  };
}
