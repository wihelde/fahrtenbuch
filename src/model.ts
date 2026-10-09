import { z } from "zod";

export const tripValuesSchema = z.object({
  date: z.iso.date(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  arrivalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().nonnegative(),
  startLat: z.number().min(-90).max(90),
  startLng: z.number().min(-180).max(180),
  endLat: z.number().min(-90).max(90).nullable(),
  endLng: z.number().min(-180).max(180).nullable(),
  distanceKm: z.number().nonnegative(),
  odometerKm: z.number().int().nonnegative(),
  consumption: z.number().nullable(),
  fuelPrice: z.number().nonnegative(),
  cost: z.number().nullable(),
  category: z.enum(["Freizeit", "Geschäftlich"]),
});

export const tripSchema = tripValuesSchema.extend({
  id: z.number().int(),
  importId: z.string(),
  arrivalDate: z.iso.date().optional(),
  startInstant: z.iso.datetime().optional(),
});
export const archiveSchema = z.object({ trips: z.array(tripSchema) });
export const importSchema = z.object({
  id: z.string(),
  filename: z.string(),
  importedAt: z.iso.datetime(),
  tripCount: z.number().int(),
});
export type TripValues = z.infer<typeof tripValuesSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type Import = z.infer<typeof importSchema>;

const filterNumber = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number());

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
      return true;
    } catch {
      return false;
    }
  }, "Bitte eine gültige Zeitzone wählen.");
export const clockQuerySchema = z.object({ timeZone: timeZoneSchema.optional() });

export const filtersSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    category: z.enum(["Freizeit", "Geschäftlich"]).optional(),
    missing: z.enum(["any", "consumption", "cost"]).optional(),
    timeZone: timeZoneSchema.optional(),
    lat: filterNumber.pipe(z.number().min(-90).max(90)).optional(),
    lng: filterNumber.pipe(z.number().min(-180).max(180)).optional(),
    radiusKm: filterNumber.pipe(z.number().positive()).optional(),
  })
  .refine(
    (filters) =>
      [filters.lat, filters.lng, filters.radiusKm].every((value) => value === undefined) ||
      [filters.lat, filters.lng, filters.radiusKm].every((value) => value !== undefined),
    {
      message: "Ortssuche benötigt Breitengrad, Längengrad und einen positiven Radius.",
    },
  )
  .refine((filters) => !filters.from || !filters.to || filters.from <= filters.to, {
    message: "Der Beginn muss vor dem Ende des Zeitraums liegen.",
  });
export type TripFilters = z.infer<typeof filtersSchema>;
export const analysisFiltersSchema = filtersSchema
  .safeExtend({
    compare: z.enum(["previous", "year"]).optional(),
  })
  .refine((filters) => !filters.compare || Boolean(filters.from && filters.to), {
    message: "Für den Vergleich bitte Von und Bis wählen.",
  });

export const summarySchema = z.object({
  count: z.number().int().nonnegative(),
  distanceKm: z.number().nonnegative(),
  consumption: z.number().nullable(),
  cost: z.number().nullable(),
  missingConsumptionCount: z.number().int().nonnegative(),
  missingCostCount: z.number().int().nonnegative(),
  consumptionDistanceKm: z.number().nonnegative(),
  consumptionCoverage: z.number().min(0).max(1).nullable(),
});
const monthSummarySchema = summarySchema.extend({ month: z.string().regex(/^\d{4}-\d{2}$/) });
const daySummarySchema = summarySchema.extend({ date: z.iso.date() });
const sourceDates = { sourceFrom: z.iso.date(), sourceTo: z.iso.date() };
export const analysisSchema = summarySchema.extend({
  months: z.array(monthSummarySchema),
  days: z.array(daySummarySchema),
  comparison: summarySchema
    .extend({
      from: z.iso.date(),
      to: z.iso.date(),
      months: z.array(monthSummarySchema.extend(sourceDates)),
      days: z.array(daySummarySchema.extend(sourceDates)),
    })
    .optional(),
  odometer: z.array(tripSchema.pick({ id: true, date: true, startTime: true, odometerKm: true })),
});
export type Analysis = z.infer<typeof analysisSchema>;
export type SummaryAnalysis = z.infer<typeof summarySchema>;

export const correctionsSchema = z.object({
  category: z.object({ value: tripValuesSchema.shape.category }).strict().nullable(),
  consumption: z.object({ value: tripValuesSchema.shape.consumption }).strict().nullable(),
  cost: z.object({ value: tripValuesSchema.shape.cost }).strict().nullable(),
});
export const correctionPatchSchema = correctionsSchema
  .extend({
    consumption: z.union([
      correctionsSchema.shape.consumption,
      z.object({ calculated: z.literal(true) }).strict(),
    ]),
    cost: z.union([
      correctionsSchema.shape.cost,
      z.object({ calculated: z.literal(true) }).strict(),
    ]),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
export type CorrectionPatch = z.infer<typeof correctionPatchSchema>;
export const tripDetailSchema = z.object({
  calculatedCost: z.number().nullable(),
  calculatedConsumption: z.number().nullable(),
  base: tripValuesSchema,
  corrections: correctionsSchema,
  trip: tripSchema,
  source: z.object({ import: importSchema, values: z.record(z.string(), z.string()) }),
});
export type TripDetail = z.infer<typeof tripDetailSchema>;
export const importResultSchema = importSchema.extend({
  newCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
  appliedCount: z.number().int().nonnegative(),
  encoding: z.string(),
  delimiter: z.string(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(
    z.object({ line: z.number().int().positive(), field: z.string(), reason: z.string() }),
  ),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const changedFieldSchema = tripValuesSchema.keyof();
export const importPreviewSchema = importResultSchema
  .omit({ id: true, importedAt: true, tripCount: true, appliedCount: true })
  .extend({
    token: z.string(),
    changes: z.array(
      z.object({
        id: z.number().int(),
        before: tripValuesSchema,
        after: tripValuesSchema,
        fields: z.array(changedFieldSchema),
      }),
    ),
  });
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const routeGeometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(2),
});
export const reconstructedRouteSchema = z.object({
  distanceKm: z.number().nonnegative(),
  geometry: routeGeometrySchema,
});
export type ReconstructedRoute = z.infer<typeof reconstructedRouteSchema>;
export const routeResultSchema = z.discriminatedUnion("status", [
  reconstructedRouteSchema.extend({ status: z.literal("ready"), differenceKm: z.number() }),
  z.object({ status: z.enum(["missing-target", "round-trip", "unavailable"]) }),
]);
export type RouteResult = z.infer<typeof routeResultSchema>;
