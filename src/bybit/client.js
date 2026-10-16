import { createHmac, randomUUID } from 'node:crypto';
import { config } from '../config.js';

/**
 * Minimal Bybit V5 REST client.
 * Docs: https://bybit-exchange.github.io/docs/v5/intro
 *
 * Signature (HMAC-SHA256): timestamp + apiKey + recvWindow + (queryString | jsonBody)
 */
export class BybitError extends Error {
  constructor(message, retCode, extra) {
    super(message);
    this.name = 'BybitError';
    this.retCode = retCode;
    this.extra = extra;
  }
}

export class BybitClient {
  constructor({ apiKey, apiSecret } = {}) {
    this.apiKey = apiKey ?? config.bybit.apiKey;
    this.apiSecret = apiSecret ?? config.bybit.apiSecret;
    this.baseUrl = config.bybit.restUrl;
    this.recvWindow = config.bybit.recvWindow;
  }

  sign(payload, timestamp) {
    return createHmac('sha256', this.apiSecret)
      .update(`${timestamp}${this.apiKey}${this.recvWindow}${payload}`)
      .digest('hex');
  }

  async request(method, path, params = {}, { auth = true } = {}) {
    const timestamp = Date.now().toString();
    let url = this.baseUrl + path;
    let body;
    let payload = '';

    if (method === 'GET') {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      if (qs) url += '?' + qs;
      payload = qs;
    } else {
      body = JSON.stringify(params);
      payload = body;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      if (!this.apiKey || !this.apiSecret) throw new BybitError('API credentials missing', -1);
      Object.assign(headers, {
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': String(this.recvWindow),
        'X-BAPI-SIGN': this.sign(payload, timestamp),
        'X-BAPI-SIGN-TYPE': '2',
      });
    }

    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BybitError(`Bybit HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    if (json.retCode !== 0) {
      throw new BybitError(json.retMsg || 'Bybit error', json.retCode, json.retExtInfo);
    }
    return json.result;
  }

  get(path, params, opts) { return this.request('GET', path, params, opts); }
  post(path, params, opts) { return this.request('POST', path, params, opts); }

  // ---------- Public market data ----------
  serverTime() { return this.get('/v5/market/time', {}, { auth: false }); }
  tickers(category, symbol) { return this.get('/v5/market/tickers', { category, symbol }, { auth: false }); }
  instruments(category, symbol) { return this.get('/v5/market/instruments-info', { category, symbol, limit: 1000 }, { auth: false }); }
  kline(category, symbol, interval, limit = 200) { return this.get('/v5/market/kline', { category, symbol, interval, limit }, { auth: false }); }
  orderbook(category, symbol, limit = 50) { return this.get('/v5/market/orderbook', { category, symbol, limit }, { auth: false }); }
  recentTrades(category, symbol, limit = 50) { return this.get('/v5/market/recent-trade', { category, symbol, limit }, { auth: false }); }

  // ---------- Master key: API key info (what services are we allowed to run?) ----------
  queryApiKey() { return this.get('/v5/user/query-api'); }

  // ---------- Master key: sub-account management ----------
  createSubMember({ username, memberType = 1, switch_ = 0, isUta = 1, note }) {
    return this.post('/v5/user/create-sub-member', { username, memberType, switch: switch_, isUta, note });
  }
  createSubApiKey({ subuid, note, readOnly = 0, ips, permissions }) {
    return this.post('/v5/user/create-sub-api', { subuid, note, readOnly, ips, permissions });
  }
  subMembers() { return this.get('/v5/user/query-sub-members'); }
  subDepositAddress(coin, chainType, subMemberId) {
    return this.get('/v5/asset/deposit/query-sub-member-address', { coin, chainType, subMemberId });
  }
  subDepositRecords(subMemberId, coin, limit = 50) {
    return this.get('/v5/asset/deposit/query-sub-member-record', { subMemberId, coin, limit });
  }
  subAccountCoinsBalance(memberId, accountType = 'UNIFIED', coin) {
    return this.get('/v5/asset/transfer/query-account-coins-balance', { memberId, accountType, coin, withBonus: 0 });
  }
  coinInfo(coin) { return this.get('/v5/asset/coin/query-info', { coin }); }

  universalTransfer({ transferId = randomUUID(), coin, amount, fromMemberId, toMemberId, fromAccountType = 'UNIFIED', toAccountType = 'UNIFIED' }) {
    return this.post('/v5/asset/transfer/universal-transfer', {
      transferId, coin, amount: String(amount), fromMemberId: Number(fromMemberId), toMemberId: Number(toMemberId), fromAccountType, toAccountType,
    });
  }
  withdraw({ coin, chain, address, tag, amount, accountType = 'FUND', feeType = 0 }) {
    return this.post('/v5/asset/withdraw/create', {
      coin, chain, address, tag, amount: String(amount), timestamp: Date.now(), forceChain: 0, accountType, feeType,
    });
  }
  withdrawRecords(withdrawID) { return this.get('/v5/asset/withdraw/query-record', { withdrawID, limit: 50 }); }

  // ---------- Sub key: account / trading ----------
  walletBalance(accountType = 'UNIFIED') { return this.get('/v5/account/wallet-balance', { accountType }); }
  placeOrder(order) { return this.post('/v5/order/create', order); }
  cancelOrder({ category, symbol, orderId }) { return this.post('/v5/order/cancel', { category, symbol, orderId }); }
  openOrders(category, symbol) { return this.get('/v5/order/realtime', { category, symbol, limit: 50, openOnly: 0 }); }
  orderHistory(category, symbol) { return this.get('/v5/order/history', { category, symbol, limit: 50 }); }
  executions(category, symbol) { return this.get('/v5/execution/list', { category, symbol, limit: 50 }); }
  setLeverage({ category, symbol, leverage }) { return this.post('/v5/position/set-leverage', { category, symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) }); }
  positions(category, settleCoin = 'USDT') { return this.get('/v5/position/list', { category, settleCoin, limit: 50 }); }
  transactionLog(accountType = 'UNIFIED') { return this.get('/v5/account/transaction-log', { accountType, limit: 50 }); }
}

export const master = new BybitClient();
