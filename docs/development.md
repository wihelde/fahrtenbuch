# Development

## Local setup

Use Bun 1.4.2 or newer. From the repository directory:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [localhost:5173](http://localhost:5173). The development command runs the Bun API and Vite frontend together. Stop both with Ctrl+C. The API defaults to port 3000 and localhost; Vite proxies `/api` to that port.

Optional configuration is described in [configuration.md](configuration.md). SQLite is included in Bun; a separate database service is not needed.

To serve the built application directly:

```sh
bun run build
bun run start
```

Open [localhost:3000](http://localhost:3000).

## Automated checks

```sh
bun run check
```

This checks TypeScript, Oxlint, Oxfmt, API integration tests, and the production build. Tests launch real Bun servers with temporary SQLite archives and synthetic inputs. They verify behavior through HTTP, including byte-identical original downloads, rather than reading internal tables. Routing tests use controlled local HTTP responses.

The Linux update command has separate CLI tests, run as root with Python 3 and Git:

```sh
python3 tests/test_update.py
```

These use temporary synthetic installations and do not require Docker or actual trip data. They cover a successful update, a build failure and retry, image preservation before a build, recovery of a missing running image, and a temporarily unavailable application during startup. See [operations.md](operations.md#update-command-for-a-linux-host) for the installation layout and other required Linux tools. They are not part of `bun run check`, which also runs on macOS.

For a new behavior or bug fix, first reproduce it with a failing behavior test, implement the smallest change that passes, then move to the next case. Prefer API tests for import, persistence, corrections, filters, and summaries. Use a small number of browser checks for interactions and rendering that API tests cannot establish. Avoid tests that merely duplicate implementation details or assert third-party library behavior.

## Focused browser checks

The scripts in `scripts/check-*.sh` require the separately installed `agent-browser` CLI and a running application. Pass the URL explicitly:

```sh
bash scripts/check-appearance.sh http://127.0.0.1:3000/
bash scripts/check-missing-filters.sh http://127.0.0.1:3000/
bash scripts/check-category-filter.sh http://127.0.0.1:3000/
bash scripts/check-header.sh http://127.0.0.1:3000/
bash scripts/check-chart-dialog.sh http://127.0.0.1:3000/
```

Each uses its own browser session and closes it afterward. They change browser selections, not archive data. Most require imported journeys: header checks need at least one, category checks need trips in both categories, missing-value checks need meaningful missing and complete entries, and chart checks need several periods. Use a separate synthetic archive, never a private archive or running deployment for development verification.

You can start an isolated demonstration after building:

```sh
export FAHRTENBUCH_DEMO_DIR="$(mktemp -d)"
DATA_DIR="$FAHRTENBUCH_DEMO_DIR" PORT=4399 HOST=127.0.0.1 bun run start
```

Open [localhost:4399](http://localhost:4399), import `examples/demo-trips.csv`, and choose **Gesamter Zeitraum**. Its dates are fixed, so the default recent-period filter may not include them. Run browser checks against that URL in another terminal. Stop the demo process when finished; it leaves the normal `data/` untouched.

## Project structure

- `src/csv.ts`: export format recognition and row validation.
- `src/archive.ts`: SQLite persistence, originals, reimports, and corrections.
- `src/server.ts`: public HTTP interface and built frontend delivery.
- `src/analysis.ts`, `src/periods.ts`, `src/geography.ts`: summaries, comparison periods, and proximity matching.
- `src/*.tsx`, `src/style.css`, `public/appearance.js`: responsive interface and appearance initialization.
- `tests/`: HTTP integration tests and the isolated Linux update command tests.
- `examples/demo-trips.csv`: synthetic input suitable for demonstrations.

## Documentation and publication

Use [the current specification](specification.md) for product behavior and test boundaries, [PRODUCT.md](../PRODUCT.md) for product principles, and [DESIGN.md](../DESIGN.md) for interface conventions. Update the relevant documents with intentional changes.

Do not publish actual exports, archive directories, backups, private environment settings, or historical personal planning notes. `.gitignore` excludes local artifacts from new commits; it does not erase files or information from existing Git history. Check the history before the first public publication.

No CI configuration, dependency-update automation, or public container registry is currently included. The Docker quick start builds the application from this repository.
