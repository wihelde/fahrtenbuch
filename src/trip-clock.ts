import type { TripValues } from "./model";

/** Convert an explicitly selected UTC export for display, preserving stored identities. */
export function createTripClock(timeZone?: string) {
  const format = timeZone
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : null;
  const clock = (instant: Date) => {
    const parts = Object.fromEntries(
      format!.formatToParts(instant).map(({ type, value }) => [type, value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  };
  return <T extends TripValues>(trip: T): T & { arrivalDate?: string; startInstant?: string } => {
    if (!format) return trip;
    const start = new Date(`${trip.date}T${trip.startTime}:00Z`);
    const arrival = new Date(`${trip.date}T${trip.arrivalTime}:00Z`);
    // In UTC mode the export date is interpreted as the departure day.
    if (trip.arrivalTime < trip.startTime) arrival.setUTCDate(arrival.getUTCDate() + 1);
    const displayedStart = clock(start);
    const displayedArrival = clock(arrival);
    return {
      ...trip,
      date: displayedStart.date,
      startTime: displayedStart.time,
      startInstant: start.toISOString(),
      arrivalTime: displayedArrival.time,
      arrivalDate: displayedArrival.date,
    };
  };
}
