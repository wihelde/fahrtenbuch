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

Run the browser integration tests separately (Node.js 22 or 24 is required for the Playwright runner):

```sh
bun x playwright install chromium
bun run test:e2e
```

`test:e2e` builds the production frontend and checks it in Chromium in desktop and mobile layouts. Each test starts a real Bun server with an empty temporary archive. It covers CSV uploads and original downloads, duplicate and changed reimports with both confirmation choices, combined filters and summaries, sorting across more than one page, saved corrections and reset, and trip details with map endpoints and reconstructed geometry. Uncaught browser errors fail the tests. Routing uses a local HTTP fixture; map tile requests deliberately fail to verify that trips remain usable without the external background. No private archive or live deployment is used.

Failures retain screenshots and Playwright traces in `test-results/`; GitLab also receives a JUnit report. To inspect a trace, run `bun x playwright show-trace test-results/<failed-test>/trace.zip`. The suite has no automatic retries, so a failing first run remains visible.

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

GitLab CI runs the checks above on branches, tags, and merge requests using the self-managed runner tagged `home-linux`. Browser tests run in a separate Node container with Bun and the Chromium version required by the installed Playwright package. The Linux update-command tests run in a separate Python container. All checks use temporary synthetic data. Run both `bun run check` and `bun run test:e2e` for equivalent local application checks; the Linux updater tests additionally require a Linux environment.

Renovate proposes dependency updates; automerge is disabled and successful CI is required before merging. Updates do not deploy the application. No public container registry is included; the Docker quick start builds the application from this repository.

The repository extends `local>wihel_de/renovate`. The shared preset enables the Dependency Dashboard and defines the open-MR limit; the accompanying preset change raises this limit from three to ten per project. The project requires a release timestamp and a minimum release age of 21 days; updates that cannot establish their age remain pending. This ages each candidate release, not the time since Renovate first noticed it.

Project update groups are React with React DOM and their type packages, Bun images with the Bun CLI installation in CI and Bun types, Vite with its React plugin and Vitest, and Leaflet with its types. Within each group, major and minor updates can share an MR so a major upgrade can include a compatible plugin or type update even if its version numbering differs. A group bundles available updates; it does not require every member to have a new release or force identical version numbers. CI verifies the resulting combination. The Bun CLI version in `.gitlab-ci.yml` is detected by a custom regex manager; Dockerfile and CI image tags use Renovate's built-in managers.

Updates, including major versions, create normal merge requests automatically once eligible. No Dependency Dashboard approval is required; review and merge decisions happen in the MR. The dashboard is an optional overview, not a prerequisite for updates.

Renovate's release-age check does not cover every indirect package resolved while generating `bun.lock`, and some update types such as lockfile maintenance and replacements are not aged. Additional Bun package-manager restrictions, immutable Docker image digests, security-update exceptions and patch automerge are separate policy decisions.
