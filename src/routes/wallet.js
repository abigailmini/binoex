import { Router } from 'express';
import { master } from '../bybit/client.js';
import { config } from '../config.js';
import { q, audit } from '../db.js';
import { requireAuth, userClient } from '../auth.js';
import { getServices } from '../services.js';

export const walletRouter = Router();
walletRouter.use(requireAuth);

/** Unified account balances of the user's sub-account (via their own sub key). */
walletRouter.get('/balance', async (req, res, next) => {
  try {
    const r = await userClient(req.user).walletBalance('UNIFIED');
    const acct = r.list?.[0] || {};
    res.json({
      accountType: acct.accountType,
      totalEquity: acct.totalEquity,
      totalWalletBalance: acct.totalWalletBalance,
      totalAvailableBalance: acct.totalAvailableBalance,
      coins: (acct.coin || [])
        .map((c) => ({
          coin: c.coin,
          walletBalance: c.walletBalance,
          availableToWithdraw: c.availableToWithdraw || c.walletBalance,
          usdValue: c.usdValue,
          locked: c.locked,
        }))
        .filter((c) => Number(c.walletBalance) !== 0),
    });
  } catch (e) { next(e); }
});

/** Deposit assets offered + Bybit coin/chain details (min deposit, confirmations). */
walletRouter.get('/deposit/assets', async (req, res, next) => {
  try {
    const coins = [...new Set(config.depositAssets.map((a) => a.coin))];
    const info = await Promise.all(coins.map((c) => master.coinInfo(c).catch(() => null)));
    const byCoin = Object.fromEntries(info.filter(Boolean).map((r) => [r.rows?.[0]?.coin, r.rows?.[0]]));
    res.json({
      assets: config.depositAssets.map((a) => {
        const chain = byCoin[a.coin]?.chains?.find((ch) => ch.chain === a.chain || ch.chainType === a.chain) || {};
        return {
          coin: a.coin, chain: a.chain,
          chainName: chain.chainType || a.chain,
          depositMin: chain.depositMin, confirmation: chain.confirmation,
          chainDeposit: chain.chainDeposit, chainWithdraw: chain.chainWithdraw,
          withdrawFee: chain.withdrawFee, withdrawMin: chain.withdrawMin,
        };
      }),
    });
  } catch (e) { next(e); }
});

/** Deposit address of the user's Bybit sub-account. Funds land directly in their sub UID. */
walletRouter.get('/deposit/address', async (req, res, next) => {
  try {
    const coin = String(req.query.coin || '').toUpperCase();
    const chain = String(req.query.chain || '').toUpperCase();
    if (!config.depositAssets.some((a) => a.coin === coin && a.chain === chain)) {
      return res.status(400).json({ error: 'Unsupported coin/chain' });
    }
    const r = await master.subDepositAddress(coin, chain, req.user.bybit_uid);
    const ch = r.chains || {};
    res.json({ coin: r.coin, chain: ch.chain || chain, chainType: ch.chainType, address: ch.addressDeposit, tag: ch.tagDeposit || '' });
  } catch (e) { next(e); }
});

walletRouter.get('/deposit/history', async (req, res, next) => {
  try {
    const r = await master.subDepositRecords(req.user.bybit_uid, req.query.coin ? String(req.query.coin).toUpperCase() : undefined);
    res.json({ list: r.rows || [] });
  } catch (e) { next(e); }
});

/**
 * Withdrawal. Bybit only allows withdrawals from the master account, so:
 *   1. universal transfer  sub(UNIFIED) -> master(FUND)
 *   2. master withdraw to the user's address
 * Note: Bybit API withdrawals require the destination address to be on the
 * master account's address whitelist (or "unrestricted" API withdraw enabled).
 */
walletRouter.post('/withdraw', async (req, res, next) => {
  const { coin, chain, address, tag, amount } = req.body || {};
  const C = String(coin || '').toUpperCase(), CH = String(chain || '').toUpperCase();
  if (!config.depositAssets.some((a) => a.coin === C && a.chain === CH)) return res.status(400).json({ error: 'Unsupported coin/chain' });
  if (!address || typeof address !== 'string' || address.length < 10) return res.status(400).json({ error: 'Invalid address' });
  const amt = Number(amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'Invalid amount' });

  const svc = await getServices();
  if (!svc.bybit.canTransfer || !svc.bybit.canWithdraw) return res.status(503).json({ error: 'Withdrawals are temporarily disabled' });

  const { lastInsertRowid: wid } = q.insertWithdrawal.run(req.user.id, C, CH, address, tag || null, String(amt));
  try {
    const keyInfo = await master.queryApiKey();
    const masterUid = keyInfo.userID;
    const t = await master.universalTransfer({
      coin: C, amount: amt, fromMemberId: req.user.bybit_uid, toMemberId: masterUid, fromAccountType: 'UNIFIED', toAccountType: 'FUND',
    });
    q.updateWithdrawal.run('transferred', t.transferId, null, null, wid);

    const w = await master.withdraw({ coin: C, chain: CH, address, tag: tag || undefined, amount: amt, accountType: 'FUND' });
    q.updateWithdrawal.run('submitted', null, w.id, null, wid);
    audit(req.user.id, 'withdraw', { wid, coin: C, chain: CH, amount: amt }, req.ip);
    res.json({ id: wid, status: 'submitted', bybitWithdrawId: w.id });
  } catch (e) {
    q.updateWithdrawal.run('failed', null, null, e.message, wid);
    audit(req.user.id, 'withdraw_failed', { wid, error: e.message }, req.ip);
    next(e);
  }
});

walletRouter.get('/withdraw/history', (req, res) => {
  res.json({ list: q.withdrawalsByUser.all(req.user.id) });
});
