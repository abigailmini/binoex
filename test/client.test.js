import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.BYBIT_RECV_WINDOW = '5000';

const { BybitClient } = await import('../src/bybit/client.js');
const { encrypt, decrypt } = await import('../src/crypto.js');

test('V5 signature = HMAC(ts + key + recvWindow + payload)', () => {
  const c = new BybitClient({ apiKey: 'KEY', apiSecret: 'SECRET' });
  const ts = '1700000000000';
  const payload = 'category=spot&symbol=BTCUSDT';
  const expected = createHmac('sha256', 'SECRET').update(`${ts}KEY5000${payload}`).digest('hex');
  assert.equal(c.sign(payload, ts), expected);
});

test('request builds signed GET with sorted-as-given query and headers', async () => {
  const c = new BybitClient({ apiKey: 'KEY', apiSecret: 'SECRET' });
  let captured;
  globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ retCode: 0, result: { ok: 1 } })); };
  const r = await c.get('/v5/x', { b: 1, a: undefined, c: 'z' });
  assert.deepEqual(r, { ok: 1 });
  assert.ok(captured.url.endsWith('/v5/x?b=1&c=z'));
  const h = captured.init.headers;
  assert.equal(h['X-BAPI-API-KEY'], 'KEY');
  assert.equal(h['X-BAPI-SIGN'], c.sign('b=1&c=z', h['X-BAPI-TIMESTAMP']));
});

test('request surfaces Bybit retCode errors', async () => {
  const c = new BybitClient({ apiKey: 'KEY', apiSecret: 'SECRET' });
  globalThis.fetch = async () => new Response(JSON.stringify({ retCode: 10003, retMsg: 'API key is invalid.' }));
  await assert.rejects(c.post('/v5/order/create', {}), (e) => e.name === 'BybitError' && e.retCode === 10003);
});

test('secrets round-trip through AES-GCM', () => {
  const s = 'super-secret-' + Math.random();
  const blob = encrypt(s);
  assert.notEqual(blob, s);
  assert.equal(decrypt(blob), s);
});
