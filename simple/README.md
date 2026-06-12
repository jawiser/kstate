# Simple variant

A rewrite of the scanner using plainer methods: two flat function-based
modules instead of eight class-based ones, written the way a developer who
mostly works in Python would write JavaScript (top-down code, snake_case,
module-level state, no classes or dependency injection).

| File | Role |
| --- | --- |
| `index.html` | Same page markup as the main app (reuses `../styles.css`) |
| `helpers.js` | Pure logic: ISBN math, SRU URL building, XML parsing, CSV |
| `app.js` | Everything else: settings, history, lookup, page updates, camera |
| `tests/helpers.test.mjs` | Node tests for everything in `helpers.js` |

Behavior matches the main app feature-for-feature (camera with native +
Quagga engines, manual entry, verdicts, history with tallies, CSV and
diagnostics exports, connection settings). It uses its own localStorage
keys (`gift-triage.*.simple.v1`) so the two variants don't clobber each
other's saved data.

Run locally from the repo root (`npm run serve`), then open
`http://localhost:8000/simple/index.html`.

Tests are picked up by the root `npm test` along with the main suites.
The `npm run check` type checking only covers the main `src/` code, not
this directory.
