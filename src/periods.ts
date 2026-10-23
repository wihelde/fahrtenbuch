export type ComparisonMode = "previous" | "year";
export type DateRange = { from: string; to: string };
export const periodPresets = [
  ["30", "Letzte 30 Tage"],
  ["7", "Letzte 7 Tage"],
  ["90", "Letzte 90 Tage"],
  ["month", "Dieser Monat"],
  ["last-month", "Letzter Monat"],
  ["year", "Dieses Jahr"],
  ["last-year", "Letztes Jahr"],
  ["all", "Gesamter Zeitraum"],
] as const;

/** Use browser-local today, but do calendar arithmetic in UTC to avoid DST shifts. */
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Chart buckets select a whole calendar day or month, including leap days. */
export function bucketRange(key: string): DateRange {
  if (key.length === 10) return { from: key, to: key };
  const end = new Date(`${key}-01T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: `${key}-01`, to: end.toISOString().slice(0, 10) };
}

/** February 29 uses February 28 in years without that calendar date. */
export function shiftYear(date: string, years: number) {
  const value = new Date(`${date}T12:00:00Z`);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() + years);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}

export function periodRange(preset: string): DateRange {
  const to = today();
  const first = `${to.slice(0, 7)}-01`;
  switch (preset) {
    case "month":
      return { from: first, to };
    case "last-month": {
      const end = addDays(first, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "year":
      return { from: `${to.slice(0, 4)}-01-01`, to };
    case "last-year": {
      const year = Number(to.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "all":
      return { from: "", to: "" };
    default:
      return { from: addDays(to, -Number(preset)), to };
  }
}

export function comparisonRange(range: DateRange, mode: ComparisonMode): DateRange {
  if (mode === "year") return { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) };
  const length = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

/** Align historical buckets for plotting while preserving their actual source dates. */
export function alignComparisonDate(date: string, range: DateRange, mode: ComparisonMode) {
  if (mode === "previous") {
    const length = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
    return addDays(date, length);
  }
  // A leap-day cohort may map to February 28; clamp a single selected February 29 to itself.
  const aligned = shiftYear(date, 1);
  return aligned < range.from ? range.from : aligned > range.to ? range.to : aligned;
}
