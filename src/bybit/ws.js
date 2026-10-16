import WebSocket, { WebSocketServer } from 'ws';
import { config } from '../config.js';

/**
 * Market-data relay.
 * One upstream connection per Bybit public stream (spot / linear) is shared by all
 * browser clients. Browsers connect to /ws and send {op:"subscribe", args:["tickers.BTCUSDT"]}
 * (same shape as Bybit) with a category: {op:"subscribe", category:"spot", args:[...]}.
 *
 * Public stream docs: https://bybit-exchange.github.io/docs/v5/ws/connect
 */
class Upstream {
  constructor(category) {
    this.category = category;
    this.url = `${config.bybit.wsUrl}/v5/public/${category}`;
    this.topics = new Map(); // topic -> Set<client>
    this.ws = null;
    this.backoff = 1000;
    this.connect();
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('open', () => {
      this.backoff = 1000;
      console.log(`[ws:${this.category}] connected`);
      const args = [...this.topics.keys()];
      if (args.length) ws.send(JSON.stringify({ op: 'subscribe', args }));
      this.ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 'ping' })), 20_000);
    });
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (!msg.topic) return; // pong / subscribe acks
      const clients = this.topics.get(msg.topic);
      if (!clients?.size) return;
      const out = JSON.stringify({ category: this.category, ...msg });
      for (const c of clients) if (c.readyState === 1) c.send(out);
    });
    ws.on('close', () => this.reconnect());
    ws.on('error', (e) => { console.error(`[ws:${this.category}]`, e.message); ws.close(); });
  }

  reconnect() {
    clearInterval(this.ping);
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  subscribe(client, topic) {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    }
    set.add(client);
  }

  unsubscribe(client, topic) {
    const set = this.topics.get(topic);
    if (!set) return;
    set.delete(client);
    if (!set.size) {
      this.topics.delete(topic);
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'unsubscribe', args: [topic] }));
    }
  }

  dropClient(client) {
    for (const topic of [...this.topics.keys()]) this.unsubscribe(client, topic);
  }
}

const ALLOWED_TOPIC = /^(tickers|orderbook\.(1|50|200)|publicTrade|kline\.(1|3|5|15|30|60|120|240|360|720|D|W|M))\.[A-Z0-9]+$/;

export function attachMarketRelay(server) {
  const upstreams = {};
  const up = (cat) => (upstreams[cat] ??= new Upstream(cat));
  for (const cat of ['spot', 'linear']) if (config.enabledServices.includes(cat)) up(cat);

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (client) => {
    client.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      const cat = ['spot', 'linear', 'inverse', 'option'].includes(msg.category) ? msg.category : 'spot';
      if (msg.op === 'ping') return client.send(JSON.stringify({ op: 'pong' }));
      if (!Array.isArray(msg.args)) return;
      const args = msg.args.filter((t) => typeof t === 'string' && ALLOWED_TOPIC.test(t)).slice(0, 50);
      if (msg.op === 'subscribe') for (const t of args) up(cat).subscribe(client, t);
      if (msg.op === 'unsubscribe') for (const t of args) up(cat).unsubscribe(client, t);
    });
    client.on('close', () => Object.values(upstreams).forEach((u) => u.dropClient(client)));
  });
  return wss;
}
