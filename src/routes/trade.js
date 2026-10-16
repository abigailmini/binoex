import { Router } from 'express';
import { config } from '../config.js';
import { audit } from '../db.js';
import { requireAuth, userClient } from '../auth.js';
import { getServices, liveCategories } from '../services.js';

export const tradeRouter = Router();
tradeRouter.use(requireAuth);

async function checkCategory(category) {
  const svc = await getServices();
  if (!liveCategories(svc.services).includes(category)) {
    const err = new Error(`${category} trading is not available`); err.status = 403; throw err;
  }
}
function allowedSymbol(category, symbol) {
  return (category === 'spot' ? config.spotSymbols : config.linearSymbols).includes(symbol);
}

/** Place an order on the user's sub-account. Body: {category, symbol, side, orderType, qty, price?, timeInForce?} */
tradeRouter.post('/order', async (req, res, next) => {
  try {
    const { category = 'spot', symbol, side, orderType = 'Market', qty, price, timeInForce, reduceOnly, marketUnit, triggerPrice, triggerDirection, takeProfit, stopLoss } = req.body || {};
    await checkCategory(category);
    const S = String(symbol || '').toUpperCase();
    if (!allowedSymbol(category, S)) return res.status(400).json({ error: 'Market not listed' });
    if (!['Buy', 'Sell'].includes(side)) return res.status(400).json({ error: 'side must be Buy or Sell' });
    if (!['Market', 'Limit'].includes(orderType)) return res.status(400).json({ error: 'orderType must be Market or Limit' });
    if (!(Number(qty) > 0)) return res.status(400).json({ error: 'Invalid qty' });
    if (orderType === 'Limit' && !(Number(price) > 0)) return res.status(400).json({ error: 'Limit orders need a price' });

    const order = { category, symbol: S, side, orderType, qty: String(qty) };
    if (orderType === 'Limit') { order.price = String(price); order.timeInForce = ['GTC', 'IOC', 'FOK', 'PostOnly'].includes(timeInForce) ? timeInForce : 'GTC'; }
    // Conditional (trigger) orders: Bybit needs triggerPrice + triggerDirection (1 = rises to, 2 = falls to)
    if (Number(triggerPrice) > 0) { order.triggerPrice = String(triggerPrice); order.triggerDirection = Number(triggerDirection) === 2 ? 2 : 1; if (category === 'spot') order.orderFilter = 'StopOrder'; }
    if (Number(takeProfit) > 0) order.takeProfit = String(takeProfit);
    if (Number(stopLoss) > 0) order.stopLoss = String(stopLoss);
    // Spot market buys are quoted in quote currency by default on Bybit; let the UI choose.
    if (category === 'spot' && orderType === 'Market' && marketUnit) order.marketUnit = marketUnit; // baseCoin | quoteCoin
    if (category !== 'spot' && reduceOnly) order.reduceOnly = true;

    const r = await userClient(req.user).placeOrder(order);
    audit(req.user.id, 'order', { ...order, orderId: r.orderId }, req.ip);
    res.json({ orderId: r.orderId, orderLinkId: r.orderLinkId });
  } catch (e) { next(e); }
});

tradeRouter.post('/order/cancel', async (req, res, next) => {
  try {
    const { category = 'spot', symbol, orderId } = req.body || {};
    await checkCategory(category);
    const r = await userClient(req.user).cancelOrder({ category, symbol: String(symbol || '').toUpperCase(), orderId: String(orderId || '') });
    audit(req.user.id, 'cancel', { category, symbol, orderId }, req.ip);
    res.json(r);
  } catch (e) { next(e); }
});

tradeRouter.get('/orders', async (req, res, next) => {
  try {
    const category = String(req.query.category || 'spot');
    await checkCategory(category);
    const c = userClient(req.user);
    const [open, history] = await Promise.all([c.openOrders(category), c.orderHistory(category)]);
    res.json({ open: open.list || [], history: history.list || [] });
  } catch (e) { next(e); }
});

tradeRouter.get('/executions', async (req, res, next) => {
  try {
    const category = String(req.query.category || 'spot');
    await checkCategory(category);
    res.json({ list: (await userClient(req.user).executions(category)).list || [] });
  } catch (e) { next(e); }
});

/** Set leverage on a derivatives symbol (cross/isolated handled by Bybit account mode). */
tradeRouter.post('/leverage', async (req, res, next) => {
  try {
    const { category = 'linear', symbol, leverage } = req.body || {};
    await checkCategory(category);
    const S = String(symbol || '').toUpperCase(), lev = Number(leverage);
    if (!allowedSymbol(category, S)) return res.status(400).json({ error: 'Market not listed' });
    if (!(lev >= 1 && lev <= 200)) return res.status(400).json({ error: 'Invalid leverage' });
    await userClient(req.user).setLeverage({ category, symbol: S, leverage: lev });
    audit(req.user.id, 'leverage', { symbol: S, leverage: lev }, req.ip);
    res.json({ ok: true, leverage: lev });
  } catch (e) {
    if (e.retCode === 110043) return res.json({ ok: true, leverage: Number(req.body?.leverage) }); // "leverage not modified"
    next(e);
  }
});

tradeRouter.get('/positions', async (req, res, next) => {
  try {
    const category = String(req.query.category || 'linear');
    await checkCategory(category);
    res.json({ list: (await userClient(req.user).positions(category)).list || [] });
  } catch (e) { next(e); }
});
