# Product principles

Fahrtenbuch helps vehicle owners retain trip exports, find individual journeys, and understand changes in distance, fuel consumption, and costs. The current importer supports German MyPeugeot CSV exports; the product name does not imply support for other export formats.

The current scope is one user and one vehicle on a private network or VPN, used on desktop, tablet, and phone. The interface is German; repository documentation is English.

## Principles

- Preserve original files and imported values. Show missing and unusual data without silently cleaning it.
- Separate imported values, user corrections, calculated suggestions, and reconstructed routes.
- Apply the same selection and effective values to the trip list, summaries, and charts.
- Keep CSV import easy to find and research focused on concrete journeys and periods.
- Use dense desktop tables and readable mobile trip rows, with immediate feedback and clear states.
- Keep installation and persistence small: one application container with SQLite and an external data directory.

## Interface

Use a restrained, carefully spaced interface with strong typography and clear hierarchy. Avoid decorative cards, pills, marketing sections, and unnecessary text. Use concise German labels and tabular numerals for trip data.

Keyboard access, visible focus, sufficient contrast, reduced motion, and accessible status feedback are part of the product. Meaning must not depend on color alone. The [design guide](DESIGN.md) describes the current interface conventions.

The [specification](docs/specification.md) records the current behavior and boundaries. Update it alongside intentional product changes.
