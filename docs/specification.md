# Current product specification

This document describes the implemented product and its boundaries. Intentional product changes should update this specification, relevant user documentation, and behavior tests together.

## Purpose and scope

Provide a self-hosted archive that collects trip exports, supports research into individual journeys, and explains distance, fuel consumption, and costs over time.

The current scope is one vehicle, one user, a German interface, and German MyPeugeot CSV exports. Run it on a trusted private network or VPN. There is no account management or authentication.

## Domain terms

| Term | Meaning |
| --- | --- |
| Trip | A journey identified by export date, start time, and odometer reading. |
| Original export | The exact uploaded file bytes, retained for download and inspection. |
| Imported value | A parsed value from an accepted export row. |
| Correction | A separate user override of category, consumption, or cost. |
| Effective value | The correction when present, otherwise the imported value. |
| Calculated suggestion | A derived consumption or cost value that requires explicit adoption. |
| Reconstructed route | A plausible road route between exported endpoints, not a recorded track. |

## Import and persistence

- Retain original files without modifying their bytes and preserve parsed original field strings alongside accepted trips.
- Treat date, start time, and odometer together as identity. An identical reimport does not add trips. Changing an identity field creates a new trip; there is no fuzzy merge.
- Show changed imported values for known identities before accepting them. Keeping existing values can still add new trips. Keep corrections across accepted reimports.
- Skip identical repeated rows within a file. Reject contradictory rows for the same identity and ambiguous existing identities without changing the archive.
- Import valid rows from an otherwise structurally readable file; report invalid rows with line, field, and reason. Reject an unreadable schema or overall CSV structure.
- Report encoding, delimiter, new/unchanged/changed/applied counts, and row errors.
- Confirmation previews last 15 minutes and become stale after an intervening archive change or server restart.
- Store SQLite, original exports, corrections, and route cache together in one persistent local directory outside the application container.

## CSV format

Require these twelve column names in this order, including the two spaces in the consumption and cost headers:

| Column | Accepted content |
| --- | --- |
| `Datum` | A calendar date in `DD.MM.YYYY`. |
| `Uhrzeit des Fahrbeginns` | `HH:MM`. |
| `Uhrzeit der Ankunft` | `HH:MM`. |
| `Dauer (S:Min)` | Hours and minutes, for example `1:23`; zero is allowed. |
| `Adresse des Fahrbeginns` | A complete latitude/longitude pair using decimal points and a separating comma. |
| `Adresse der Ankunft` | The same coordinate format, or entirely empty. |
| `Entfernung (km)` | A nonnegative number in kilometers. |
| `Kilometerstand auf dem Zähler (km)` | A nonnegative integer in kilometers. |
| `Durchschn Verbrauch  (l/100km)` | A readable signed number, or empty. |
| `Kraftstoffpreis (EUR/l)` | A nonnegative number in euros per liter. |
| `Kosten  (EUR)` | A readable signed number in euros, or empty. |
| `Kategorie` | `Freizeit` or `Geschäftlich`. |

Support UTF-8 with or without BOM, UTF-16 with BOM, semicolon/comma/tab delimiters, and correctly quoted fields. Decimal points are supported. Decimal commas and European thousands separators are interpreted only when the row's number format can be identified unambiguously; do not guess ambiguous values. Coordinates must be within geographic bounds.

Retain missing consumption, cost, and destination values as missing. Do not reinterpret missing as zero. Readable outliers, including signed consumption and cost, remain visible and participate in calculations until corrected.

The export has no timezone. By default, use its date and clock times unchanged for grouping, filtering, and sorting without inventing a UTC timestamp or a different departure day. Preserve exported duration rather than recomputing it from clock times. Indicate journeys crossing midnight without asserting an inferred departure date.

Users can explicitly interpret all export times as UTC and choose a display timezone, initially suggested from the browser. This preference persists in that browser. In this mode, interpret the export date as the departure day and an earlier arrival clock time as the next UTC day. Convert both endpoints with daylight-saving rules. Lists, details, date filters, daily/monthly groups, comparisons, and odometer observations use the resulting local departure dates and times. Chronological ordering must remain correct when clocks move backwards. Show the arrival date when different from the departure date. Keep imported values, original CSVs, trip identities, and saved corrections unchanged; original timestamps remain available in trip details. The UI must identify the active timezone and the UTC interpretation.

## Research and corrections

- Start with browser-local today and a start date 30 days earlier, with inclusive boundaries. Provide recent-day, calendar-month/year, and whole-archive presets.
- Combine date, category, missing consumption/cost, and proximity filters across the list and every summary/chart.
- A proximity match needs a start or destination inside a positive radius; a missing destination does not prevent start matching. It does not search route geometry.
- Sort all eight list columns in either direction across the full selection before displaying pages of at most 50 rows. Place missing values last and reset pagination when selection or sorting changes.
- Show original source, imported values, effective values, and corrections in trip details.
- Permit category, consumption, and cost overrides; each can return to its imported value.
- Offer consumption as `cost / fuel price / distance * 100` when cost exists and distance and price are positive. Offer cost as `distance * consumption / 100 * fuel price` when consumption exists. Adopt either only with an explicit action, without prior rounding.
- Keep field actions and feedback beside the field, preserve drafts in other fields, and avoid scroll jumps.

## Analysis and charts

Compute summaries from all effective selected trips, independently of pagination. Average consumption is `sum(distance * consumption) / sum(distance)` across trips with consumption. Return no average when covered distance is zero. Show covered distance/proportion and missing counts. Sum all available costs, including trips without consumption; an entirely missing total remains missing.

Provide daily and monthly groups, initially selecting the newest observed period. Share explicit period selection across distance, consumption, and cost charts. Hover/focus tooltips show values without changing selection. Fit the overview to its width and provide a wide chart dialog with measure switching, comparison, and precise keyboard/touch selection.

Compare against an immediately preceding range of equal inclusive length or the same calendar dates one year earlier, applying the same other filters. Retain actual source dates when aligning historical groups for plotting. Use February 28 for a shifted February 29 when needed. Omit days with no trips in either selection, without turning missing values into zero.

Plot imported odometer readings chronologically with date and start time attached to each observation. Do not smooth or repair those values.

## Maps and routing

Show exported endpoints independently of tile and routing availability. Use OpenStreetMap tiles and preserve attribution. Reconstruct a route only on opening a suitable detail and an uncached route request. Send only endpoint coordinates, cache successful geometry and distance, and show the distance difference without modifying the import.

Skip missing destinations and likely round trips: identical endpoints, or endpoints at most 100 meters apart with an exported distance above one kilometer. Retain usable trip data during external failures and allow retry. Limit route starts to one per second within the server and combine identical in-flight requests.

## Interface and operation

Use responsive desktop/mobile layouts, semantic controls, keyboard access, visible focus, accessible status messages, and reduced motion. Offer System/Light/Dark appearance with live system tracking and persistent explicit preference. Follow [the design guide](../DESIGN.md).

Use Bun, React/Vite, SQLite, and one Docker container. Keep logs useful without recording CSV contents or coordinates. Document configuration and full-directory backups, restores, version changes, and rollback. The application does not schedule backups.

## Test boundaries

Use public HTTP behavior with temporary SQLite archives for import, reimports, corrections, filtering, persistence, and analysis. Verify original downloads byte for byte. Control routing responses at the external HTTP boundary. Add focused browser checks for critical interactions and rendering, using synthetic data. For new behavior or a bug fix, reproduce it with a failing test before implementation.

## Outside the current scope

Other CSV schemas, multiple vehicles/users, authentication, actual GPS tracks, searching places passed along a route, geocoding, offline map archives, automatic data cleanup, arbitrary categories, full edit history, and automatic backups are not implemented. Date/time, distance, odometer, price, and coordinates are not manually editable; confirmed reimports can change non-identity imported fields. No dependency-update automation or CI configuration is included.
