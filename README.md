# Gift Triage Scanner

A static browser tool for K-State Libraries gift triage: scan a book's ISBN
barcode with a phone camera (or type it) and instantly see whether the item
is already in the catalog (Search It / Alma). Verdicts are saved locally so
a whole cart of donations can be triaged in one session.

No backend, no build step, no dependencies beyond the Quagga scanner
library loaded from a CDN — the repo is served as-is (e.g. via GitHub
Pages) and all scan data stays in the browser. The only network traffic is
the catalog query itself.

## Using the tool

1. Open the hosted page on a phone.
2. Tap **Start camera** and aim at the barcode starting **978/979** on the
   back cover. The scanner automatically skips the smaller UPC price
   barcode. If the camera is unavailable, type the ISBN manually.
3. Read the verdict:
   - **ALREADY HELD** — a catalog record matches; holdings are listed.
   - **NOT IN CATALOG** — no record matches this ISBN. A different edition
     might still be held; **Open in Search It** double-checks by title.
   - **CHECK MANUALLY** — the lookup failed (network, CORS, timeout). The
     diagnostic category is shown; **Open in Search It** always works.
4. Every checked ISBN lands in **Saved scans** with running tallies
   (held / not in catalog / check manually). **Clear history** wipes the
   saved list after a confirmation.

Scan history persists in this browser's localStorage (up to 500 entries)
and never leaves the device.

## Run locally

The app uses browser ES modules, so serve the directory over HTTP instead
of opening the HTML file directly:

```sh
npm run serve
```

Then open `http://localhost:8000/gift-triage-scanner.html`.

## Tests

Pure logic (ISBN checksums and conversion, SRU URL building, MARCXML
parsing) is covered by Node's built-in test runner — no packages needed:

```sh
npm test
```

## Project layout

| Path | Role |
| --- | --- |
| `gift-triage-scanner.html` | Page markup; loads `app.js` as a module |
| `styles.css` | All styling |
| `app.js` | Browser code: history, catalog lookup, page updates, camera scanning |
| `helpers.js` | Pure logic: ISBN math, SRU URL building, XML parsing |
| `tests/helpers.test.mjs` | Tests for everything in `helpers.js` |

The code is plain top-down functions (no classes, no framework).
`helpers.js` has no browser dependencies so it runs under `node --test`;
everything DOM/camera related stays in `app.js`.

## Configuration

Connection values (Alma SRU endpoint, optional CORS proxy prefix, Primo
view) are hardcoded in the `SETTINGS` constant at the top of `app.js`.
Edit there to point the tool at a different institution.

If direct browser calls to the Alma SRU endpoint are blocked by CORS
(lookups consistently end in **CHECK MANUALLY** with diagnostic
`network_or_cors`), set `proxy_base` to a pass-through proxy prefix; the
full SRU URL is appended URL-encoded. The **Open in Search It** button is
unaffected by CORS either way.

## How a scan becomes a verdict

1. The camera engine (native `BarcodeDetector` where supported, Quagga
   elsewhere) decodes an EAN-13 barcode; non-978/979 codes are skipped as
   price barcodes.
2. The ISBN is checksum-validated and expanded to its ISBN-10 form when one
   exists (older catalog records may only carry that form).
3. An SRU `searchRetrieve` query asks Alma for matching records, with a 9s
   timeout and one retry on transient failures.
4. The MARCXML response is parsed for record count, title (245), year
   (264/260), and holdings (AVA), and rendered as the verdict card.

## Deployment

Push to the default branch with GitHub Pages enabled; no build is needed.
The camera requires a secure context (HTTPS or `localhost`), which GitHub
Pages provides.
