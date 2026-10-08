# Interface design

The interface prioritizes readable trip data, consistent interactions, and clear feedback on desktop and small screens. Its labels and numeric formatting are German.

## Structure and typography

- Use system fonts, clear heading levels, and tabular numerals for values.
- Keep the compact header: Fahrtenbuch on the left, appearance and CSV import actions on the right.
- Use the available width for the archive rather than reserving space for a single-item sidebar.
- Use a dense table on desktop and readable trip rows on mobile.
- Round only the outer table boundary, not each row or row heading.
- Avoid decorative cards, pills, marketing sections, and light gray section dividers.

## Color and appearance

Use semantic color roles consistently for surfaces, text, controls, notices, and charts. Red identifies primary actions and active controls; blue and green distinguish measures or states with supporting labels.

The appearance button cycles through System, Light, and Dark. Its accessible name and tooltip identify the current and next modes. Explicit preferences persist in the browser; System follows live operating-system changes. Load the saved preference before painting through the separate CSP-compatible appearance script.

Map tiles retain their original cartographic colors. Test explicit light and dark preferences against the opposite operating-system setting, including the colors emitted by the production build.

## Charts

Keep the three summary charts side by side when space permits. Fit bars to the available width and reduce label density for long ranges. Use one continuous background per chart with rounding at the outer boundary.

Select the newest period initially. Clicking a bar selects the same period across all three measures. Hover and keyboard focus show exact values without changing the selection. Missing values use hatching and labels instead of appearing as zero.

An expand action opens one measure in a wide native dialog, using the full screen on small devices. Measure changes preserve the selected period. Keep daily/monthly views, comparisons, and a selection slider available. Escape closes the dialog and focus returns to its opener; render chart tooltips inside the dialog's top layer.

For odometer readings, display date, start time, and value together. Include an intermediate scale and a keyboard-accessible slider for precise observation selection.

## Forms and feedback

Place calculated suggestions and save actions next to their fields. Manual edits have a separate save action; adopting a suggestion also saves it. Show success and errors at the field without moving the viewport or losing drafts elsewhere.

Use native file selection and semantic forms, tables, and dialogs. Maintain visible focus, touch targets of at least 44 pixels, screen-reader status announcements, and reduced-motion behavior. Keep loading, empty, failure, and success states brief and actionable.
