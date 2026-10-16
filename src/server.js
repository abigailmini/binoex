import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, assertConfig } from './config.js';
import { authRouter } from './routes/auth.js';
import { marketRouter } from './routes/market.js';
import { walletRouter } from './routes/wallet.js';
import { tradeRouter } from './routes/trade.js';
import { getServices } from './services.js';
import { attachMarketRelay } from './bybit/ws.js';
import { BybitError } from './bybit/client.js';

assertConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
}));
app.use(express.json({ limit: '32kb' }));
// tiny cookie parser (only need `token`)
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  next();
});

app.use('/api/', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));

app.get('/api/services', async (_req, res, next) => {
  try {
    const s = await getServices();
    // never expose raw key permission dump to the public
    res.json({ brand: s.brand, services: s.services, markets: s.markets, depositAssets: s.depositAssets, online: s.bybit.reachable, withdrawals: s.bybit.canWithdraw && s.bybit.canTransfer });
  } catch (e) { next(e); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRouter);
app.use('/api/market', marketRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/trade', tradeRouter);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof BybitError) {
    console.error('[bybit]', err.retCode, err.message);
    return res.status(502).json({ error: err.message, code: err.retCode });
  }
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
});

const server = http.createServer(app);
attachMarketRelay(server);
server.listen(config.port, () => {
  console.log(`[binoex] ${config.brand.name} listening on http://localhost:${config.port}  (bybit: ${config.bybit.restUrl})`);
  getServices().then((s) => {
    if (!s.bybit.reachable) return console.warn('[binoex] Bybit unreachable or key invalid:', s.bybit.error);
    console.log('[binoex] master key ok. live services:', Object.values(s.services).filter((x) => x.live).map((x) => x.id).join(', ') || 'none',
      '| withdrawals:', s.bybit.canWithdraw && s.bybit.canTransfer ? 'on' : 'OFF (key lacks Withdraw/Transfer)');
  });
});
