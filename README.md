# BTC Up/Down Trading System

React dashboard + Node.js backend for Polymarket BTC up/down markets (CLOB V2).

## Architecture

```text
Frontend (React) → Backend API + WebSocket → Bot engine → CLOB V2
```

Private keys and CLOB auth stay **only** in the backend `.env`.

## Quick start

### 1. Install

```bash
cd btc-updown-trading-system
npm install
```

### 2. Configure secrets

Copy `.env.example` to `backend/.env` and fill in:

- `PRIVATE_KEY` — wallet used to sign orders
- `DEPOSIT_WALLET_ADDRESS` — funder address (if using signature type 3)
- `POLY_API_KEY` / `POLY_API_SECRET` / `POLY_API_PASSPHRASE` — optional; derived on startup if omitted

Keep `BOT_MODE=dry-run` (virtual money) until you validate signals in the UI. Switch to real money in the dashboard or set `BOT_MODE=live`.

Market discovery uses Gamma slug lookup only: `btc-updown-5m-{unix_window_start}` (5-minute BTC up/down). Token IDs rotate each window; see `GET /api/market` for `upTokenId` / `downTokenId`.

### 3. Run

```bash
npm run dev
```

- API: http://localhost:3001
- WebSocket: ws://localhost:3002
- UI: http://localhost:5173

### VPN / explicit hosts

Add to your root `.env` (loaded by Vite and the backend):

```env
VITE_API_HOST=http://127.0.0.1:3001
VITE_WS_HOST=ws://127.0.0.1:3002
FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
```

Use `127.0.0.1` instead of `localhost` if your VPN breaks DNS for localhost. Restart `npm run dev` after changing these.

## API (frontend uses these)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | API process alive |
| GET | `/api/clob/status` | CLOB_HOST reachability + auth test |
| GET | `/api/state` | Full snapshot |
| GET | `/api/market` | Market + books + BTC |
| GET | `/api/bot` | Bot status + signal |
| POST | `/api/bot/start` | Start bot |
| POST | `/api/bot/pause` | Pause |
| POST | `/api/bot/stop` | Stop |
| POST | `/api/bot/mode` | `{ "mode": "virtual" \| "real" }` (or `dry-run` / `live`) |
| POST | `/api/bot/reset-virtual-balance` | Reset paper balance |
| POST | `/api/orders/cancel-all` | Cancel CLOB orders |
| GET | `/api/history/:kind` | JSONL tail (`signals`, `orders`, …) |

## Project layout

- `backend/` — Express API, WebSocket, CLOB client, strategies, risk, execution, JSONL history
- `frontend/` — React dashboard (Vite)

History files are written to `backend/history/*.jsonl`.

## Safety

- **Virtual money** (`BOT_MODE=dry-run`): simulated fills, tracked paper balance (`VIRTUAL_STARTING_BALANCE_USD`), no CLOB orders.
- **Real money** (`BOT_MODE=live`): orders hit Polymarket. Switch only after reviewing virtual trades.
- Never put `PRIVATE_KEY` in the frontend.
