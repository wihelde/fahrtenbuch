import type { TripValues } from "./model";

/** Interpret local export dates with UTC clocks, preserving stored identities. */
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
    // MyPeugeot exports the local departure date but UTC clock times.
    const localDate = clock(start).date;
    if (localDate !== trip.date)
      start.setUTCDate(start.getUTCDate() + (localDate > trip.date ? -1 : 1));
    const arrival = new Date(`${start.toISOString().slice(0, 10)}T${trip.arrivalTime}:00Z`);
    if (arrival < start) arrival.setUTCDate(arrival.getUTCDate() + 1);
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
