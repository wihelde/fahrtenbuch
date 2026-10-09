# HTTP API

The API is intended for the same private network or VPN as the interface. It has no authentication. Error messages and category values are German. Archive responses use `Cache-Control: no-store`.

## Read endpoints

| Method and path | Result |
| --- | --- |
| `GET /api/trips` | `{ trips: [...] }`, containing effective values for all matching trips. |
| `GET /api/analysis` | Summary, daily/monthly groups, odometer observations, and an optional comparison. |
| `GET /api/trips/:id` | Effective `trip`, imported `base`, current `corrections`, original `source`, and calculated suggestions. |
| `GET /api/imports` | `{ imports: [...] }` with archived filenames, IDs, timestamps, and trip counts. |
| `GET /api/imports/:id/file` | Unmodified original export bytes as a CSV attachment. |
| `GET /api/trips/:id/route` | Reconstructed route or an explicit unavailable/unsupported status. |

A missing trip or original export returns 404. Invalid filters return 400.

## Filters

Both trip and analysis endpoints accept:

| Query parameter | Meaning |
| --- | --- |
| `from`, `to` | Inclusive departure-date boundaries in `YYYY-MM-DD` format, according to the selected display timezone or unchanged export date. Either can be omitted without comparison. |
| `category` | `Freizeit` or `Geschäftlich`. |
| `missing` | `any`, `consumption`, or `cost`. Uses effective values; zero is present. |
| `timeZone` | Optional IANA display timezone such as `Europe/Berlin`. Explicitly interprets exported times as UTC. Omit to retain unchanged export dates and times. Also accepted by `GET /api/trips/:id`. |
| `lat`, `lng`, `radiusKm` | Proximity to start or destination. Provide all three together, with a positive radius in kilometers. |

The API returns the whole matching collection, with no server pagination or sorting parameters. The interface sorts and paginates the returned trips. Without filters, the API uses the whole archive.

With `timeZone`, trip responses convert departure and arrival clock times, and include `arrivalDate` and the UTC `startInstant` for chronological sorting during clock changes. The export date is interpreted as the UTC departure day; an earlier arrival clock time belongs to the next UTC day. Date filters, grouping, comparisons, and odometer observations use the displayed local departure date. A trip detail's `base` and `source` retain original dates and times. Corrections and imports use stored identities; their write responses remain unconverted. Invalid timezones return 400.

```sh
curl 'http://localhost:3000/api/trips?from=2026-10-01&to=2026-10-31&missing=consumption'
```

`GET /api/analysis` also accepts `compare=previous` or `compare=year`; both date boundaries are required. `previous` uses an immediately preceding range with the same inclusive length, and `year` shifts the boundaries one calendar year back.

Summaries include `count`, `distanceKm`, `consumption`, `cost`, missing-value counts, `consumptionDistanceKm`, and `consumptionCoverage`. A missing average or an entirely missing cost total is `null`, not zero. The current groups are `days` and `months`. `odometer` contains chronological imported readings with date and start time.

Comparison groups align their `date` or `month` keys to the current period for plotting. Their `sourceFrom` and `sourceTo` preserve the actual historical dates of the trips in the group; `comparison.from` and `comparison.to` identify the historical selection boundaries.

## Imports

`POST /api/imports` accepts multipart form data with a `file` field. The request limit is 10 MiB, including multipart overhead, so leave room below that limit when choosing a CSV file.

```sh
curl --fail --form 'file=@examples/demo-trips.csv' http://localhost:3000/api/imports
```

A completed import returns 201 and import counts, encoding, delimiter, and row errors. A changed known journey produces a 202 preview with `token` and `changes`; no changes are applied at that point.

Confirm with `POST /api/imports/:token/confirm` and JSON:

```json
{ "applyChanges": true }
```

Use `false` to keep existing imported values while adding new journeys. A stale, expired, missing, or conflicting confirmation returns 409. Re-upload to create a new preview. Unreadable CSV data returns 400.

## Corrections

`PATCH /api/trips/:id/corrections` accepts a non-empty partial JSON object. Set a field with `{ "value": ... }`, remove its override with `null`, or adopt a calculated numeric suggestion with `{ "calculated": true }`.

```json
{ "consumption": { "value": 6.4 }, "category": { "value": "Freizeit" } }
```

```json
{ "consumption": { "calculated": true } }
```

```json
{ "consumption": null }
```

For consumption or cost, `{ "value": null }` explicitly overrides the effective value to missing; a top-level field value of `null` restores its imported value. Category values must be `Freizeit` or `Geschäftlich`. Unknown fields and invalid values return 400.

The trip detail returns `calculatedConsumption` and `calculatedCost` as unrounded suggestions, or `null` when prerequisites are missing. Invalid calculated adoption returns 400 without changing the archive. Corrections return the updated trip detail.

## Routes and browser origins

A ready route contains `status: "ready"`, `distanceKm`, `differenceKm` (routing distance minus imported distance), and GeoJSON `geometry`. Other statuses are `round-trip`, `missing-target`, and `unavailable`.

The route endpoint rejects foreign browser origins with 403, including same-site requests that are not same-origin. Imports and corrections reject foreign `Origin` headers or cross-site browser requests. These checks are not authentication and do not restrict direct non-browser clients. Keep the service on a trusted network.

An HTTPS reverse proxy can use the explicitly configured `APP_ORIGIN` as an additional trusted browser origin. See [reverse proxy configuration](configuration.md#https-reverse-proxy). Unconfigured proxy headers do not grant access.

A cache miss can contact the configured routing provider and disclose the endpoints. See [maps and reconstructed routes](usage.md#maps-and-reconstructed-routes).
