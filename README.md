This is a static browser tool for scanning an ISBN with a phone camera and checking whether the item is already in the K-State Libraries collection.

## Run locally

The app uses browser ES modules, so serve the directory over HTTP instead of opening the HTML file directly:

```sh
npm run serve
```

Then open `http://localhost:8000/gift-triage-scanner.html`.

## Tests

```sh
npm test
```
