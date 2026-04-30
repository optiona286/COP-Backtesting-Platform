# COP Backtesting Platform

Local TXO options backtesting platform for loading TAIFEX daily option tick files, selecting contracts by settlement metadata, replaying market data, and testing manual or rule-based option order flows.

## Current Runtime

The app now runs as a single local Node.js service:

- Frontend: `index.html`, `css/`, `js/`
- Backend: `server.js`
- Default URL: `http://localhost:5000`
- Bind address: `127.0.0.1`
- Main data source: `fsp_data.csv` plus local TAIFEX ZIP files under `data/`

The old Python/Flask backend file is kept in the project as a legacy reference, but new backend work should use the Node local API flow.

## Start The App

Recommended hidden launcher on Windows:

```bat
Start_OP_PRO.vbs
```

This launcher:

- stops any process already listening on port `5000`
- starts `server.js` with Node.js
- opens `http://localhost:5000`
- does not show a CMD window

Visible fallback launcher:

```bat
start-node.bat
```

Manual start:

```bat
node server.js
```

## API Routes

Health check:

```text
GET /ping
```

Contract metadata:

```text
GET /api/contracts
GET /api/summary
GET /api/fsp-data
```

Contract tick data:

```text
GET /api/contract-data/:contractKey
```

Cache utilities:

```text
GET /api/cache/status
GET /api/cache/clear
```

## Data Files

`fsp_data.csv` is tracked because it contains settlement metadata used to build the contract selector.

Raw TAIFEX daily ZIP files should be placed locally under:

```text
data/YYYY/OptionsDaily_YYYY_MM_DD.zip
```

These ZIP files are intentionally ignored by Git because they are large and frequently refreshed. The backend scans `data/` at startup.

## UI Notes

The initial UI theme is dark mode. `index.html` loads with `body.dark-mode`, and the theme button can switch back to the light theme.

## Validation

Useful local checks:

```bat
node --check server.js
node --check js\main.js
```

Runtime smoke checks:

```text
http://127.0.0.1:5000/ping
http://127.0.0.1:5000/api/contracts
```
