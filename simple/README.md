# Simple variant

A rewrite of the scanner using plainer methods: two flat function-based
modules instead of eight class-based ones, written the way a developer who
mostly works in Python would write JavaScript (top-down code, snake_case,
module-level state, no classes or dependency injection).

| File | Role |
| --- | --- |
| `index.html` | Same page markup as the main app, minus settings/export UI (reuses `../styles.css`) |
| `helpers.js` | Pure logic: ISBN math, SRU URL building, XML parsing |
| `app.js` | Everything else: history, lookup, page updates, camera |
| `tests/helpers.test.mjs` | Node tests for everything in `helpers.js` |

Core behavior matches the main app (camera with native + Quagga engines,
manual entry, verdicts, history with tallies and a clear button). This
variant deliberately drops the connection-settings panel and the
CSV/diagnostics exports: connection values are hardcoded in the `SETTINGS`
constant at the top of `app.js`. History still persists in localStorage
under its own key (`gift-triage.history.simple.v1`) so the two variants
don't clobber each other's saved data.

Run locally from the repo root (`npm run serve`), then open
`http://localhost:8000/simple/index.html`.

Tests are picked up by the root `npm test` along with the main suites.
The `npm run check` type checking only covers the main `src/` code, not
this directory.
