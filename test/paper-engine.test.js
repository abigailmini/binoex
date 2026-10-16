import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/paper-engine.js';

const { PaperEngine } = globalThis;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(Number(a) - Number(b)) < eps, `${a} ≉ ${b}`);

function make(px = { 'linear:BTCUSDT': 50000, 'spot:BTCUSDT': 50000, 'spot:ETHUSDT': 2000 }) {
  const saves = [];
  const e = new PaperEngine({ getPrice: (c, s) => px[`${c}:${s}`], onChange: (s) => saves.push(JSON.stringify(s)) });
  return { e, px, saves };
}

test('spot market buy/sell moves balances and charges fees', () => {
  const { e } = make();
  e.placeOrder({ category: 'spot', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 1 });
  near(e.bal('USDT'), 50000); near(e.bal('BTC'), 0.999);
  e.placeOrder({ category: 'spot', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: 0.999 });
  near(e.bal('BTC'), 0); near(e.bal('USDT'), 50000 + 0.999 * 50000 * (1 - 0.001));
  assert.equal(e.executions('spot').length, 2);
});

test('insufficient funds is rejected', () => {
  const { e } = make();
  assert.throws(() => e.placeOrder({ category: 'spot', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 3 }), /Insufficient USDT/);
  assert.throws(() => e.placeOrder({ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 100 }), /Insufficient margin/);
});

test('limit order rests, locks funds, fills on tick, cancels', () => {
  const { e } = make();
  const o = e.placeOrder({ category: 'spot', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: 1, price: 49000 });
  assert.equal(o.orderStatus, 'New'); near(e.available('USDT'), 51000);
  assert.equal(e.tick('spot', 'BTCUSDT', 49500), false);
  assert.equal(e.tick('spot', 'BTCUSDT', 48900), true);
  assert.equal(e.orders('spot').history[0].orderStatus, 'Filled'); near(e.bal('USDT'), 51000);
  const o2 = e.placeOrder({ category: 'spot', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: 0.5, price: 40000 });
  e.cancelOrder(o2.orderId);
  assert.equal(e.openOrders().length, 0); near(e.available('USDT'), 51000);
});

test('post-only that would take liquidity is rejected', () => {
  const { e } = make();
  const o = e.placeOrder({ category: 'spot', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: 0.1, price: 60000, timeInForce: 'PostOnly' });
  assert.equal(o.orderStatus, 'Rejected');
});

test('linear position: open, unrealised pnl, partial close realises pnl, flip', () => {
  const { e, px } = make();
  e.setLeverage('BTCUSDT', 10);
  e.placeOrder({ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 2 });
  let [p] = e.positions();
  assert.equal(p.side, 'Buy'); near(p.size, 2); near(p.avgPrice, 50000); near(p.positionIM, 10000);
  near(e.bal('USDT'), 100000 - 2 * 50000 * 0.00055);
  px['linear:BTCUSDT'] = 55000;
  [p] = e.positions(); near(p.unrealisedPnl, 10000);
  near(e.balance().totalEquity, e.bal('USDT') + 10000);
  e.placeOrder({ category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: 1, reduceOnly: true });
  [p] = e.positions(); near(p.size, 1);
  near(e.bal('USDT'), 100000 - 2 * 50000 * 0.00055 - 55000 * 0.00055 + 5000);
  e.placeOrder({ category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: 3 }); // closes 1, opens 2 short
  [p] = e.positions(); assert.equal(p.side, 'Sell'); near(p.size, 2); near(p.avgPrice, 55000);
});

test('conditional order triggers; TP/SL attach as reduce-only stops and clean up', () => {
  const { e, px } = make();
  const c = e.placeOrder({ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 1, triggerPrice: 51000, triggerDirection: 1, takeProfit: 56000, stopLoss: 48000 });
  assert.equal(c.orderStatus, 'Untriggered');
  e.tick('linear', 'BTCUSDT', 50500); assert.equal(e.positions().length, 0);
  px['linear:BTCUSDT'] = 51200; e.tick('linear', 'BTCUSDT', 51200);
  assert.equal(e.positions().length, 1);
  const open = e.openOrders(); assert.equal(open.length, 2); assert.ok(open.every((o) => o.reduceOnly));
  px['linear:BTCUSDT'] = 56100; e.tick('linear', 'BTCUSDT', 56100);
  assert.equal(e.positions().length, 0, 'take profit closed the position');
  assert.equal(e.openOrders().length, 0, 'stop loss cancelled once flat');
  near(e.bal('USDT'), 100000 + (56100 - 51200) - 51200 * 0.00055 - 56100 * 0.00055);
});

test('state round-trips through JSON and onChange fires', () => {
  const { e, saves, px } = make();
  e.placeOrder({ category: 'spot', symbol: 'ETHUSDT', side: 'Buy', orderType: 'Market', qty: 2 });
  assert.ok(saves.length >= 1);
  const e2 = new PaperEngine({ state: JSON.parse(saves.at(-1)), getPrice: (c, s) => px[`${c}:${s}`] });
  near(e2.bal('ETH'), 2 * (1 - 0.001));
  assert.equal(e2.balance().coins.find((c) => c.coin === 'ETH').coin, 'ETH');
});
