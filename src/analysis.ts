import type { Trip, SummaryAnalysis } from "./model";
import { alignComparisonDate, type ComparisonMode, type DateRange } from "./periods";

/** Summarize effective values for the entire selected archive, including outliers. */
export function summarize(trips: Trip[]): SummaryAnalysis {
  let distanceKm = 0;
  let consumptionDistanceKm = 0;
  let weightedConsumption = 0;
  let cost = 0;
  let missingConsumptionCount = 0;
  let missingCostCount = 0;
  for (const trip of trips) {
    distanceKm += trip.distanceKm;
    if (trip.consumption === null) missingConsumptionCount++;
    else {
      consumptionDistanceKm += trip.distanceKm;
      weightedConsumption += trip.distanceKm * trip.consumption;
    }
    if (trip.cost === null) missingCostCount++;
    else cost += trip.cost;
  }
  return {
    count: trips.length,
    distanceKm,
    consumption: consumptionDistanceKm > 0 ? weightedConsumption / consumptionDistanceKm : null,
    cost: trips.length > missingCostCount ? cost : null,
    missingConsumptionCount,
    missingCostCount,
    consumptionDistanceKm,
    consumptionCoverage: distanceKm > 0 ? consumptionDistanceKm / distanceKm : null,
  };
}

/** Group only observed export dates and months using the same effective-value summary. */
export function analyze(trips: Trip[]) {
  const months = new Map<string, Trip[]>();
  const days = new Map<string, Trip[]>();
  for (const trip of trips) {
    const month = trip.date.slice(0, 7);
    const group = months.get(month) ?? [];
    group.push(trip);
    months.set(month, group);
    const day = days.get(trip.date) ?? [];
    day.push(trip);
    days.set(trip.date, day);
  }
  return {
    ...summarize(trips),
    odometer: [...trips]
      .sort(
        (a, b) =>
          (a.startInstant ?? `${a.date}T${a.startTime}`).localeCompare(
            b.startInstant ?? `${b.date}T${b.startTime}`,
          ) || a.id - b.id,
      )
      .map(({ id, date, startTime, odometerKm }) => ({ id, date, startTime, odometerKm })),
    months: [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, rows]) => ({ month, ...summarize(rows) })),
    days: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, ...summarize(rows) })),
  };
}

/** Apply the same effective-value summary to aligned historical cohorts. */
export function compare(trips: Trip[], range: DateRange, mode: ComparisonMode, source: DateRange) {
  const groups = (monthly: boolean) => {
    const buckets = new Map<string, Trip[]>();
    for (const trip of trips) {
      const date = alignComparisonDate(trip.date, range, mode);
      const key = monthly ? date.slice(0, 7) : date;
      const rows = buckets.get(key) ?? [];
      rows.push(trip);
      buckets.set(key, rows);
    }
    return [...buckets]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => {
        const dates = rows.map((trip) => trip.date).sort();
        return { key, ...summarize(rows), sourceFrom: dates[0], sourceTo: dates.at(-1)! };
      });
  };
  return {
    ...summarize(trips),
    ...source,
    months: groups(true).map(({ key, ...values }) => ({ month: key, ...values })),
    days: groups(false).map(({ key, ...values }) => ({ date: key, ...values })),
  };
}
