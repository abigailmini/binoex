/* Binoex paper-trading engine. Isomorphic: loaded as a <script> in the browser and imported in Node.
 * Simulates a Bybit-like unified account (spot balances + one-way linear positions) against live prices.
 * State is a plain JSON object so it can live in localStorage or a DB column. */
(function (root) {
  const FEE = { spot: 0.001, linear: 0.00055 }; // taker fees
  const MAINT = 0.005; // maintenance margin rate used for the liq. price approximation
  const OPEN = new Set(['New', 'Untriggered', 'PartiallyFilled']);

  class PaperEngine {
    constructor({ state, getPrice, onChange } = {}) {
      this.s = state && state.balances ? state : PaperEngine.initial();
      this.getPrice = getPrice || (() => null);
      this.onChange = onChange || (() => {});
    }
    static initial(usdt = 100000) { return { v: 1, balances: { USDT: usdt }, orders: [], positions: {}, fills: [], leverage: {}, seq: 1 }; }
    static base(sym) { return sym.replace(/(USDT|USDC)$/, ''); }
    static quote(sym) { return sym.endsWith('USDC') ? 'USDC' : 'USDT'; }

    save() { this.onChange(this.s); }
    id(p) { return `${p}${Date.now().toString(36)}${(this.s.seq++).toString(36)}`; }
    price(cat, sym) { const p = Number(this.getPrice(cat, sym)); return p > 0 ? p : null; }
    bal(c) { return this.s.balances[c] || 0; }
    add(c, v) { const n = (this.s.balances[c] || 0) + v; this.s.balances[c] = Math.abs(n) < 1e-10 ? 0 : n; }
    lev(sym) { return this.s.leverage[sym] || 10; }
    setLeverage(sym, lev) { this.s.leverage[sym] = lev; const p = this.s.positions[sym]; if (p) p.leverage = lev; this.save(); }
    faucet(usdt = 10000) { this.add('USDT', usdt); this.save(); return this.bal('USDT'); }
    reset(usdt = 100000) { this.s = PaperEngine.initial(usdt); this.save(); }

    openOrders() { return this.s.orders.filter((o) => OPEN.has(o.orderStatus)); }
    usedMargin() { return Object.values(this.s.positions).reduce((t, p) => t + (p.size * p.avgPrice) / p.leverage, 0); }
    locked(coin) {
      let l = 0;
      for (const o of this.openOrders()) {
        if (o.reduceOnly) continue;
        const ref = o.price || o.triggerPrice || 0;
        if (o.category === 'spot') {
          if (o.side === 'Buy' && PaperEngine.quote(o.symbol) === coin) l += ref * o.qty;
          if (o.side === 'Sell' && PaperEngine.base(o.symbol) === coin) l += o.qty;
        } else if (coin === 'USDT') l += (ref * o.qty) / (o.leverage || this.lev(o.symbol));
      }
      return l;
    }
    available(coin) { return Math.max(0, this.bal(coin) - this.locked(coin) - (coin === 'USDT' ? this.usedMargin() : 0)); }

    placeOrder(req) {
      const category = req.category === 'spot' ? 'spot' : 'linear';
      const symbol = String(req.symbol || '').toUpperCase();
      const side = req.side === 'Sell' ? 'Sell' : 'Buy';
      const orderType = req.orderType === 'Limit' ? 'Limit' : 'Market';
      const qty = Number(req.qty), price = Number(req.price) || null, trigger = Number(req.triggerPrice) || null;
      if (!(qty > 0)) throw new Error('Invalid qty');
      if (orderType === 'Limit' && !(price > 0)) throw new Error('Limit orders need a price');
      const px = this.price(category, symbol);
      if (!px) throw new Error('No market price available yet, try again in a moment');
      const leverage = category === 'linear' ? this.lev(symbol) : 1;
      const reduceOnly = category === 'linear' && !!req.reduceOnly;
      const ref = orderType === 'Market' ? (trigger || px) : price;
      if (reduceOnly) {
        const p = this.s.positions[symbol];
        if (!p || p.side === side) throw new Error('No position to reduce');
      } else if (category === 'spot') {
        const q = PaperEngine.quote(symbol), b = PaperEngine.base(symbol);
        if (side === 'Buy' && ref * qty > this.available(q) + 1e-9) throw new Error(`Insufficient ${q} balance`);
        if (side === 'Sell' && qty > this.available(b) + 1e-12) throw new Error(`Insufficient ${b} balance`);
      } else if ((ref * qty) / leverage > this.available('USDT') + 1e-9) throw new Error('Insufficient margin (USDT)');

      const now = Date.now();
      const order = {
        orderId: this.id('o'), category, symbol, side, orderType, qty, price, leverage, reduceOnly,
        timeInForce: req.timeInForce || 'GTC', triggerPrice: trigger, triggerDirection: trigger ? (Number(req.triggerDirection) === 2 ? 2 : 1) : 0,
        takeProfit: Number(req.takeProfit) || null, stopLoss: Number(req.stopLoss) || null,
        orderStatus: trigger ? 'Untriggered' : 'New', cumExecQty: 0, avgPrice: 0, createdTime: now, updatedTime: now, orderLinkId: '',
      };
      this.s.orders.push(order);
      if (!trigger) this.tryExecute(order, px, true);
      this.save();
      return order;
    }

    tryExecute(order, px, atPlacement = false) {
      if (order.orderType === 'Market') return this.fill(order, px, false);
      const marketable = order.side === 'Buy' ? px <= order.price : px >= order.price;
      if (!marketable) return false;
      if (order.timeInForce === 'PostOnly' && atPlacement) { order.orderStatus = 'Rejected'; order.rejectReason = 'EC_PostOnlyWillTakeLiquidity'; order.updatedTime = Date.now(); return false; }
      return this.fill(order, order.price, !atPlacement);
    }

    fill(order, px, isMaker) {
      const { category, symbol, side, qty } = order;
      const fee = qty * px * FEE[category];
      if (category === 'spot') {
        const b = PaperEngine.base(symbol), q = PaperEngine.quote(symbol);
        if (side === 'Buy') { this.add(q, -qty * px); this.add(b, qty * (1 - FEE.spot)); }
        else { this.add(b, -qty); this.add(q, qty * px - fee); }
      } else {
        const pos = this.s.positions[symbol];
        let remaining = qty;
        if (pos && pos.side !== side) {
          const close = Math.min(remaining, pos.size);
          const pnl = (px - pos.avgPrice) * close * (pos.side === 'Buy' ? 1 : -1);
          this.add('USDT', pnl); pos.size -= close; pos.cumRealisedPnl = (pos.cumRealisedPnl || 0) + pnl; remaining -= close;
          if (pos.size <= 1e-12) delete this.s.positions[symbol];
        }
        if (remaining > 0 && !order.reduceOnly) {
          const p = this.s.positions[symbol];
          if (p) { p.avgPrice = (p.size * p.avgPrice + remaining * px) / (p.size + remaining); p.size += remaining; p.updatedTime = Date.now(); }
          else this.s.positions[symbol] = { symbol, side, size: remaining, avgPrice: px, leverage: order.leverage, createdTime: Date.now(), updatedTime: Date.now(), cumRealisedPnl: 0 };
        }
        this.add('USDT', -fee);
      }
      order.cumExecQty = qty; order.avgPrice = px; order.orderStatus = 'Filled'; order.updatedTime = Date.now();
      this.s.fills.unshift({ execId: this.id('e'), orderId: order.orderId, category, symbol, side, orderType: order.orderType, execPrice: px, execQty: qty, execValue: qty * px, execFee: fee, feeCurrency: category === 'spot' && side === 'Buy' ? PaperEngine.base(symbol) : PaperEngine.quote(symbol), execTime: Date.now(), isMaker });
      if (this.s.fills.length > 200) this.s.fills.length = 200;
      // TP / SL become reduce-only conditional market orders on the position
      if (category === 'linear' && (order.takeProfit || order.stopLoss) && this.s.positions[symbol]) {
        const opp = side === 'Buy' ? 'Sell' : 'Buy';
        const mk = (trig, dir, tag) => this.s.orders.push({ orderId: this.id('o'), category, symbol, side: opp, orderType: 'Market', qty, price: null, leverage: order.leverage, reduceOnly: true, timeInForce: 'IOC', triggerPrice: trig, triggerDirection: dir, orderStatus: 'Untriggered', cumExecQty: 0, avgPrice: 0, createdTime: Date.now(), updatedTime: Date.now(), stopOrderType: tag });
        if (order.takeProfit) mk(order.takeProfit, side === 'Buy' ? 1 : 2, 'TakeProfit');
        if (order.stopLoss) mk(order.stopLoss, side === 'Buy' ? 2 : 1, 'StopLoss');
      }
      return true;
    }

    cancelOrder(orderId) {
      const o = this.s.orders.find((x) => x.orderId === orderId);
      if (!o || !OPEN.has(o.orderStatus)) throw new Error('Order not found or already closed');
      o.orderStatus = 'Cancelled'; o.updatedTime = Date.now(); this.save(); return o;
    }

    /** Feed a price; processes resting / conditional orders for that symbol. Returns true if anything changed. */
    tick(category, symbol, px) {
      px = Number(px); if (!(px > 0)) return false;
      let changed = false;
      for (const o of this.openOrders()) {
        if (o.category !== category || o.symbol !== symbol) continue;
        if (o.orderStatus === 'Untriggered') {
          const hit = o.triggerDirection === 1 ? px >= o.triggerPrice : px <= o.triggerPrice;
          if (!hit) continue;
          o.orderStatus = 'New'; o.updatedTime = Date.now(); changed = true;
          if (o.reduceOnly) { const p = this.s.positions[symbol]; if (!p || p.side === o.side) { o.orderStatus = 'Cancelled'; continue; } o.qty = Math.min(o.qty, p.size); }
          if (o.orderType === 'Limit' && !o.reduceOnly && o.category === 'spot') { /* funds re-checked implicitly by balance going negative being allowed? keep simple */ }
        }
        if (this.tryExecute(o, px)) changed = true;
      }
      // cancel sibling TP/SL once a position is gone
      for (const o of this.openOrders()) if (o.reduceOnly && o.category === 'linear' && !this.s.positions[o.symbol]) { o.orderStatus = 'Cancelled'; o.updatedTime = Date.now(); changed = true; }
      if (changed) this.save();
      return changed;
    }

    /** Symbols that need live prices to progress (open orders + positions). */
    watchList() {
      const set = new Set();
      for (const o of this.openOrders()) set.add(o.category + ':' + o.symbol);
      for (const p of Object.values(this.s.positions)) set.add('linear:' + p.symbol);
      return [...set].map((k) => k.split(':'));
    }

    positions() {
      return Object.values(this.s.positions).map((p) => {
        const mark = this.price('linear', p.symbol) || p.avgPrice, dir = p.side === 'Buy' ? 1 : -1;
        const unrealisedPnl = (mark - p.avgPrice) * p.size * dir, positionValue = p.size * mark, positionIM = (p.size * p.avgPrice) / p.leverage;
        const liqPrice = p.avgPrice * (1 - dir * (1 / p.leverage - MAINT));
        return { ...p, category: 'linear', size: String(p.size), avgPrice: String(p.avgPrice), markPrice: String(mark), leverage: String(p.leverage), unrealisedPnl: String(unrealisedPnl), positionValue: String(positionValue), positionIM: String(positionIM), liqPrice: String(Math.max(0, liqPrice)), positionIdx: 0 };
      });
    }
    balance() {
      let equity = 0;
      const coins = Object.entries(this.s.balances).filter(([, v]) => Math.abs(v) > 1e-10).map(([coin, v]) => {
        const px = coin === 'USDT' || coin === 'USDC' ? 1 : this.price('spot', coin + 'USDT') || 0;
        const usd = v * px; equity += usd;
        return { coin, walletBalance: String(v), availableToWithdraw: String(this.available(coin)), locked: String(Math.max(0, v - this.available(coin))), usdValue: String(usd) };
      });
      const upnl = this.positions().reduce((t, p) => t + Number(p.unrealisedPnl), 0);
      return { accountType: 'UNIFIED', totalEquity: String(equity + upnl), totalWalletBalance: String(equity), totalAvailableBalance: String(this.available('USDT')), coins };
    }
    orders(category) {
      const f = (o) => (!category || o.category === category);
      const str = (o) => ({ ...o, qty: String(o.qty), price: o.price == null ? '' : String(o.price), cumExecQty: String(o.cumExecQty), avgPrice: String(o.avgPrice), triggerPrice: o.triggerPrice == null ? '' : String(o.triggerPrice), leverage: String(o.leverage) });
      return { open: this.openOrders().filter(f).map(str).reverse(), history: this.s.orders.filter((o) => !OPEN.has(o.orderStatus) && f(o)).slice(-50).map(str).reverse() };
    }
    executions(category) { return this.s.fills.filter((x) => !category || x.category === category).slice(0, 50).map((x) => ({ ...x, execPrice: String(x.execPrice), execQty: String(x.execQty), execValue: String(x.execValue), execFee: String(x.execFee) })); }
  }

  root.PaperEngine = PaperEngine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
