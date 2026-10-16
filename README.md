# Binoex

White-label crypto exchange built on the **Bybit V5 API**. Every Binoex user is a
**sub-account under your Bybit institutional master account**; deposits land in
their own Bybit sub UID, orders are placed with their own sub-account API key,
and withdrawals go sub → master → chain.

```
Browser ──HTTP/WS──> Binoex (Node) ──REST (signed)──> api.bybit.com
                         │
                         └──WS relay (one upstream conn, fan-out)──> stream.bybit.com/v5/public/{spot,linear}
```

## What's included

| Area | How it maps to Bybit |
|---|---|
| Landing page + live tickers | `GET /v5/market/tickers`, WS `tickers.*` |
| Register | `POST /v5/user/create-sub-member` (UTA sub) + `POST /v5/user/create-sub-api` (per-user key, secret AES-256-GCM at rest) |
| Login | local bcrypt + JWT (12h) |
| Wallet | `GET /v5/account/wallet-balance` with the user's sub key |
| Deposit | `GET /v5/asset/deposit/query-sub-member-address`, `.../query-sub-member-record`, `GET /v5/asset/coin/query-info` |
| Withdraw | `POST /v5/asset/transfer/universal-transfer` (sub UNIFIED → master FUND) then `POST /v5/asset/withdraw/create` |
| Spot / Perps trading | `POST /v5/order/create`, `/cancel`, `GET /v5/order/realtime`, `/history`, `/v5/position/list` |
| Order book / trades | WS `orderbook.50.*`, `publicTrade.*` |
| Service gating | `GET /v5/user/query-api` → only products the master key is permitted for (and listed in `ENABLED_SERVICES`) appear in the UI |

## Setup

1. **Bybit institutional master key** – create an API key on the master account with
   *Sub-account management*, *Wallet: Transfer + Withdraw*, *Spot/Contract trade*
   (trade perms are what gets granted to each user's sub key), *Asset read*.
   Bind it to your server IP.
   Withdrawals via API require the destination address to be on the master
   account's **address book / whitelist**, or "unrestricted API withdrawal" enabled.
2. ```bash
   cp .env.example .env         # fill BYBIT_API_KEY/SECRET, JWT_SECRET, ENCRYPTION_KEY
   openssl rand -hex 32         # -> JWT_SECRET
   openssl rand -hex 32         # -> ENCRYPTION_KEY
   npm install
   npm start                    # http://localhost:3000
   ```
3. Check `GET /api/services` – it tells you which products are live and whether
   withdrawals are enabled given the key's permissions.

Testnet: set `BYBIT_REST_URL=https://api-testnet.bybit.com` and
`BYBIT_WS_URL=wss://stream-testnet.bybit.com`.

### Docker

```bash
docker build -t binoex . && docker run --env-file .env -p 3000:3000 -v binoex-data:/app/data binoex
```

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/api/services` | – | live products, markets, deposit assets |
| POST | `/api/auth/register` `/login` `/logout` | – | `{email,password}` |
| GET | `/api/auth/me` | ✓ | |
| GET | `/api/market/tickers?category=` `instruments` `kline` `orderbook` `trades` | – | |
| GET | `/api/wallet/balance` | ✓ | |
| GET | `/api/wallet/deposit/assets` `address?coin=&chain=` `history` | ✓ | |
| POST | `/api/wallet/withdraw` | ✓ | `{coin,chain,address,tag?,amount}` |
| GET | `/api/wallet/withdraw/history` | ✓ | |
| POST | `/api/trade/order` | ✓ | `{category,symbol,side,orderType,qty,price?,marketUnit?}` |
| POST | `/api/trade/order/cancel` | ✓ | `{category,symbol,orderId}` |
| GET | `/api/trade/orders` `executions` `positions` `?category=` | ✓ | |
| WS | `/ws` | – | `{op:"subscribe",category:"spot",args:["tickers.BTCUSDT"]}` |

## Production checklist (not done yet)

- KYC / email verification / 2FA before enabling withdrawals.
- Put the app behind TLS (cookie `secure` flag follows `x-forwarded-proto`).
- Withdrawal address whitelist + manual approval queue for large amounts.
- Move SQLite → Postgres for multi-instance deployment.
- Fee markup: Bybit institutional broker rebates are configured on the Bybit side; add your own spread/fee layer in `routes/trade.js` if you want custom pricing.
- Sub-account API keys created via API expire in 90 days unless the master IP-binds them; schedule a rotation job (`POST /v5/user/update-sub-api` / recreate).
