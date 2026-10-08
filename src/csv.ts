import { parse } from "csv-parse/sync";
import { z } from "zod";
import { tripValuesSchema } from "./model";

export class CsvImportError extends Error {
  override name = "CsvImportError";
}

export const columns = [
  "Datum",
  "Uhrzeit des Fahrbeginns",
  "Uhrzeit der Ankunft",
  "Dauer (S:Min)",
  "Adresse des Fahrbeginns",
  "Adresse der Ankunft",
  "Entfernung (km)",
  "Kilometerstand auf dem Zähler (km)",
  "Durchschn Verbrauch  (l/100km)",
  "Kraftstoffpreis (EUR/l)",
  "Kosten  (EUR)",
  "Kategorie",
];

class RowError extends Error {
  constructor(
    readonly field: string,
    reason: string,
  ) {
    super(reason);
  }
}

function number(value: string, field: string, european: boolean, signed = false) {
  const token = value.trim();
  const pattern = european ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/ : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(signed ? token.replace(/^[+-]/, "") : token))
    throw new RowError(field, "Zahl ist nicht eindeutig lesbar.");
  return Number(european ? token.replaceAll(".", "").replace(",", ".") : token);
}

function coordinates(value: string, field: string): [number, number] | [null, null] {
  if (!value.trim()) return [null, null];
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match)
    throw new RowError(
      field,
      "Koordinaten müssen ein vollständiges Zahlenpaar aus Breitengrad und Längengrad sein.",
    );
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new RowError(
      field,
      "Breitengrad muss zwischen −90 und 90, Längengrad zwischen −180 und 180 liegen.",
    );
  return [lat, lng];
}

// Interpret only the date given by MyPeugeot, not a guessed departure day.
function date(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) throw new RowError("Datum", "Datum muss im Format TT.MM.JJJJ vorliegen.");
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function duration(value: string) {
  const match = value.match(/^(\d+):([0-5]\d)$/);
  if (!match) throw new RowError("Dauer", "Fahrtdauer muss in Stunden:Minuten vorliegen.");
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Recognize supported export formats and retain valid rows without modifying source bytes. */
export function readTrips(bytes: Uint8Array) {
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "UTF-16LE"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "UTF-16BE"
          : "UTF-8";
    let text: string;
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw new CsvImportError(
        "Kodierung ist nicht lesbar. Unterstützt sind UTF-8 sowie UTF-16 mit BOM.",
      );
    }
    const candidates = [";", ",", "\t"].filter((delimiter) => {
      try {
        const first = z
          .array(z.array(z.string()))
          .parse(parse(text, { delimiter, bom: true, to: 1 }))[0];
        return (
          first?.length === columns.length &&
          first.every((column, index) => column === columns[index])
        );
      } catch {
        return false;
      }
    });
    if (candidates.length !== 1)
      throw new CsvImportError(
        "Das notwendige MyPeugeot-Spaltenschema oder Trennzeichen ist nicht erkennbar. Unterstützt sind Semikolon, Komma und Tabulator.",
      );
    const delimiter = candidates[0];
    const records = z
      .array(
        z.object({
          record: z.array(z.string()),
          raw: z.string(),
          info: z.object({ lines: z.number() }),
        }),
      )
      .parse(
        parse(text, {
          delimiter,
          bom: true,
          skip_empty_lines: true,
          info: true,
          raw: true,
          relax_column_count: true,
        }),
      );
    const header = records.shift()?.record;
    if (
      !header ||
      header.length !== columns.length ||
      header.some((column, index) => column !== columns[index])
    ) {
      throw new Error("Diese Datei entspricht nicht dem unterstützten MyPeugeot-Export.");
    }
    if (records.length === 0) throw new CsvImportError("Die Datei enthält keine Fahrten.");
    const errors: { line: number; field: string; reason: string }[] = [];
    const trips = records.flatMap(({ record: values, raw, info }) => {
      const content = raw.replace(/^(?:\r\n|\r|\n)+/, "");
      const line =
        info.lines -
        (content.match(/\r\n|\r|\n/g)?.length ?? 0) +
        (/\r\n$|[\r\n]$/.test(content) ? 1 : 0);
      try {
        if (values.length !== columns.length)
          throw new RowError("Zeile", "Die Zeile enthält nicht alle zwölf CSV-Spalten.");
        const tokens = values.slice(6, 11).map((value) => value.trim());
        const european = tokens.some(
          (value) =>
            /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(value) && !/^[+-]?\d+,\d{3}$/.test(value),
        );
        const [startLat, startLng] = coordinates(values[4], "Startkoordinaten");
        const [endLat, endLng] = coordinates(values[5], "Zielkoordinaten");
        const trip = tripValuesSchema.parse({
          date: date(values[0]),
          startTime: values[1],
          arrivalTime: values[2],
          durationMinutes: duration(values[3]),
          startLat,
          startLng,
          endLat,
          endLng,
          distanceKm: number(values[6], "Entfernung", european),
          odometerKm: number(values[7], "Kilometerstand", european),
          consumption:
            values[8].trim() === "" ? null : number(values[8], "Verbrauch", european, true),
          fuelPrice: number(values[9], "Kraftstoffpreis", european),
          cost: values[10].trim() === "" ? null : number(values[10], "Kosten", european, true),
          category: values[11],
        });
        return [
          {
            trip,
            raw: JSON.stringify(
              Object.fromEntries(columns.map((column, index) => [column, values[index]])),
            ),
          },
        ];
      } catch (cause) {
        const field =
          cause instanceof z.ZodError
            ? String(cause.issues[0].path[0])
            : cause instanceof RowError
              ? cause.field
              : "Zeile";
        const names: Record<string, string> = {
          date: "Datum",
          startTime: "Startzeit",
          arrivalTime: "Ankunftszeit",
          durationMinutes: "Dauer",
          startLat: "Startkoordinaten",
          startLng: "Startkoordinaten",
          endLat: "Zielkoordinaten",
          endLng: "Zielkoordinaten",
          distanceKm: "Entfernung",
          odometerKm: "Kilometerstand",
          consumption: "Verbrauch",
          fuelPrice: "Kraftstoffpreis",
          cost: "Kosten",
          category: "Kategorie",
        };
        errors.push({
          line,
          field: names[field] ?? field,
          reason:
            cause instanceof RowError
              ? cause.message
              : cause instanceof z.ZodError && field === "date"
                ? "Datum ist kein gültiger Kalendertag."
                : "Angabe ist nicht gültig.",
        });
        return [];
      }
    });
    return { trips, errors, errorCount: errors.length, encoding, delimiter };
  } catch (cause) {
    if (cause instanceof CsvImportError) throw cause;
    throw new CsvImportError(
      "Die CSV-Struktur ist nicht lesbar. Bitte vollständige CSV-Zeilen mit korrekt geschlossenen Anführungszeichen verwenden.",
    );
  }
}
