# Using Fahrtenbuch

The interface is German. The names below match the controls you see in the application.

## Import and original files

Export your trips from MyPeugeot, select the CSV in Fahrtenbuch, and click **Fahrten importieren**. An import adds to the archive; it does not replace the existing trips. The [CSV format reference](specification.md#csv-format) describes the supported schema and encodings.

Identical journeys are skipped. If an export changes a known journey, review the old and new values and choose whether to accept the changes. Keeping existing values still allows new journeys to be added. Corrections are retained when imported values change.

For a partially invalid CSV, valid trips are imported and errors identify their source lines. An unreadable overall structure or conflicting duplicate trip identity rejects the import. The original export is archived without altering its bytes and can be downloaded under **Originaldateien**. A trip detail also identifies its source export.

Confirmation previews expire after 15 minutes and must be repeated after an intervening archive change or server restart.

Use [the synthetic sample](../examples/demo-trips.csv) only in a separate demonstration archive. Importing your own export later does not remove previously imported sample trips.

## Filters and sorting

The clock icon in the header opens **Uhrzeiten**. By default, dates and clock times are displayed exactly as exported. If your CSV uses UTC, choose **UTC in Ortszeit umrechnen** and an **Anzeigezeitzone**, for example `Europe/Berlin`. The suggested zone comes from your browser; the choice is saved in that browser only. The application does not automatically infer a source timezone.

Conversion treats the export date as the local departure date in the chosen timezone and the clock times as UTC. For example, an export dated 16 October with a departure clock of 22:16 is displayed as 16 October at 00:16 in `Europe/Berlin`, using 15 October as the UTC date. Summer/winter time and arrival date changes are handled relative to that departure instant; an earlier UTC arrival clock belongs to the next UTC day. Lists, trip details, filters, charts, and comparisons all use the local departure date. A different arrival date is shown beside the arrival time. Original dates, times, and duration remain preserved, and **Originalwerte laut CSV** in the trip detail shows the unconverted source. Switching the display mode does not alter corrections or reimport matching.

The initial range ends on today in your browser and starts 30 days earlier. Both dates are inclusive, so this covers 31 calendar dates. Presets include the last 7 or 90 days, this month or year to date, the full previous month or year, and the whole archive.

Date presets, category, missing-value filters, and comparison choices apply immediately. Apply manually entered date boundaries with **Anwenden**.

Under **Angaben**, choose **Fehlende Angaben** for trips missing consumption or cost, **Verbrauch fehlt** for consumption only, or **Kosten fehlen** for cost only. Zero is an existing value. A trip leaves the selection when its effective values no longer match the filter.

The optional location search matches a start or destination inside a selected radius; it cannot find places passed along a route. Tap the map or move it with arrow keys and press Enter to select its center. Set a positive radius and apply the location filter. A missing destination still allows a match by start. Removing the point and applying removes the location filter; **Zurücksetzen** clears all filters.

Click a table heading to sort ascending or descending. Sorting covers all matching trips before pagination; missing values always come last. On mobile, use **Sortieren nach** and the direction selector. The list contains up to 50 trips per page; summaries and charts include every matching trip.

## Corrections and suggestions

Open a journey to correct its category, consumption, or cost. Imported values remain separate and can be restored with **Importwert verwenden**.

Manual consumption and cost edits have a save button beside their field. A calculated suggestion has its own **Übernehmen und speichern** button, which adopts and saves it in one action. Other draft values are preserved. Expand the calculation explanation to inspect its inputs.

The consumption suggestion is `cost ÷ fuel price ÷ distance × 100`. The cost suggestion is `distance × consumption ÷ 100 × fuel price`. Suggestions are stored without prior rounding and only after explicit adoption. Already rounded source values make these estimates. Consumption requires existing cost and positive distance and fuel price; zero cost can produce zero consumption.

## Summaries and charts

Consumption is weighted by distance for trips with an effective consumption value. The coverage text tells you what proportion of selected distance contributes to that average. Missing values are not zero, and readable outliers remain in the calculation until corrected. Available costs contribute even when consumption is missing.

Switch **Monatlich** or **Täglich** under **Entwicklungen**. Periods without trips are omitted. The newest period is selected initially. Clicking a bar selects that period in all three measures; hovering or focusing shows exact values without changing the selection. Missing values use hatching. Expand the accessible data table for exact period totals.

The expand icon opens a chart in a wide dialog, or fullscreen on mobile. Switch measures without losing the selected period. Use the slider or arrow keys to reach thin bars; Escape closes the dialog and returns focus to its opener.

Odometer readings retain the exported values. The chart associates each reading with its date and start time; hovering, tapping, or the slider selects an observation.

**Vergleichen mit** offers the immediately preceding range of equal length, or the same calendar dates one year earlier. The same category, missing-value, and location filters apply to both selections. Exact historical dates accompany the comparison values. February 29 uses February 28 when the comparison year has no leap day. Empty groups are omitted only if neither selection has trips.

## Maps and reconstructed routes

Maps load tiles from OpenStreetMap in the browser. A suitable trip detail asks the application server for a reconstructed road route. With no cached result, the server sends start and destination coordinates to the configured routing service, defaulting to the public FOSSGIS car service using OSRM. It sends no trip date, category, or fuel information. Tile requests reveal the requested map area to the tile provider; routing requests disclose the endpoints to the routing provider.

A reconstructed route is a plausible estimate, not a recorded GPS track. Its distance does not replace the imported distance. A missing destination and likely round trips receive an explanation instead of a misleading route. A round trip is not reconstructed if its endpoints are identical, or at most 100 meters apart with an exported distance above one kilometer.

Routing starts are limited to one per second within the application, duplicate in-flight requests are combined, and successful geometry and distance are cached persistently. Cached routes survive restarts; changed endpoint coordinates produce a different cache key. Failures are not cached and can be retried. Tile or routing failures keep trip data and endpoints available.

External services provide no availability guarantee and may log requests. Preserve attribution and check provider terms before changing usage: [FOSSGIS routing](https://routing.openstreetmap.de/about.html), [OSRM usage policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy), and [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Appearance

The icon in the header cycles **System → Hell → Dunkel → System**. The monitor, sun, and moon identify the selected mode; its tooltip also names the next mode. Explicit choices persist in the browser. System follows operating-system changes while the page is open.
