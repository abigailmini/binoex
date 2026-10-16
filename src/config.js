import { randomBytes } from 'node:crypto';

const env = process.env;

function list(v, fallback = []) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean).length
    ? v.split(',').map((s) => s.trim()).filter(Boolean)
    : fallback;
}

export const config = {
  port: Number(env.PORT || 3000),
  isProd: env.NODE_ENV === 'production',
  appUrl: env.APP_URL || 'http://localhost:3000',
  brand: { name: 'Binoex', tagline: 'Trade crypto with institutional-grade liquidity.' },

  bybit: {
    apiKey: env.BYBIT_API_KEY || '',
    apiSecret: env.BYBIT_API_SECRET || '',
    restUrl: (env.BYBIT_REST_URL || 'https://api.bybit.com').replace(/\/$/, ''),
    wsUrl: (env.BYBIT_WS_URL || 'wss://stream.bybit.com').replace(/\/$/, ''),
    recvWindow: Number(env.BYBIT_RECV_WINDOW || 5000),
  },

  jwtSecret: env.JWT_SECRET || '',
  encryptionKey: env.ENCRYPTION_KEY || '',

  enabledServices: list(env.ENABLED_SERVICES, ['spot', 'linear']),
  spotSymbols: list(env.SPOT_SYMBOLS, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']),
  linearSymbols: list(env.LINEAR_SYMBOLS, ['BTCUSDT', 'ETHUSDT']),
  depositAssets: list(env.DEPOSIT_ASSETS, ['USDT:TRX', 'USDT:ETH', 'BTC:BTC', 'ETH:ETH']).map((s) => {
    const [coin, chain] = s.split(':');
    return { coin, chain: chain || coin };
  }),

  dbPath: env.DATABASE_PATH || './data/binoex.db',

  // Paper trading: accounts live only in our DB, orders are simulated against live Bybit prices.
  // Enabled explicitly, or automatically when no Bybit master key is configured.
  paper: env.PAPER_MODE === 'true' || !env.BYBIT_API_KEY,
  paperStartBalance: Number(env.PAPER_START_BALANCE || 100000),
};

export function assertConfig() {
  const missing = [];
  if (!config.paper) {
    if (!config.bybit.apiKey) missing.push('BYBIT_API_KEY');
    if (!config.bybit.apiSecret) missing.push('BYBIT_API_SECRET');
    if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) missing.push('ENCRYPTION_KEY (64 hex chars)');
  }
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    if (config.paper) { config.jwtSecret = randomBytes(32).toString('hex'); console.warn('[binoex] JWT_SECRET not set — generated a temporary one (sessions reset on restart).'); }
    else missing.push('JWT_SECRET (>=32 chars)');
  }
  if (missing.length) {
    console.error('[binoex] Missing/invalid configuration: ' + missing.join(', '));
    console.error('[binoex] Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
}
