import { config } from './config.js';
import { master } from './bybit/client.js';

/**
 * Service discovery: which exchange features Binoex exposes to users.
 * A service is live only when (1) enabled in ENABLED_SERVICES and
 * (2) the institutional master API key actually carries the Bybit permission for it.
 *
 * Bybit /v5/user/query-api returns permissions like:
 *   { ContractTrade:["Order","Position"], Spot:["SpotTrade"], Wallet:["AccountTransfer","SubMemberTransfer"],
 *     Options:["OptionsTrade"], Derivatives:["DerivativesTrade"], Earn:["Earn"], ... }
 */
const SERVICE_DEFS = {
  spot:    { label: 'Spot',        perm: (p) => has(p.Spot, 'SpotTrade'),                                   subPerm: { Spot: ['SpotTrade'] } },
  linear:  { label: 'USDT Perps',  perm: (p) => has(p.ContractTrade, 'Order') || has(p.Derivatives, 'DerivativesTrade'), subPerm: { ContractTrade: ['Order', 'Position'], Derivatives: ['DerivativesTrade'] } },
  inverse: { label: 'Inverse',     perm: (p) => has(p.ContractTrade, 'Order') || has(p.Derivatives, 'DerivativesTrade'), subPerm: { ContractTrade: ['Order', 'Position'] } },
  option:  { label: 'Options',     perm: (p) => has(p.Options, 'OptionsTrade'),                              subPerm: { Options: ['OptionsTrade'] } },
  earn:    { label: 'Earn',        perm: (p) => has(p.Earn, 'Earn'),                                        subPerm: { Earn: ['Earn'] } },
};

function has(arr, v) { return Array.isArray(arr) && arr.includes(v); }

let cache = { at: 0, data: null };

export async function getServices({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < 60_000) return cache.data;

  let keyInfo = null, error = null;
  try {
    keyInfo = await master.queryApiKey();
  } catch (e) {
    error = e.message;
  }
  const perms = keyInfo?.permissions || {};

  const services = {};
  for (const [id, def] of Object.entries(SERVICE_DEFS)) {
    const enabled = config.enabledServices.includes(id);
    const permitted = keyInfo ? def.perm(perms) : false;
    services[id] = { id, label: def.label, enabled, permitted, live: enabled && permitted };
  }

  const data = {
    brand: config.brand,
    bybit: {
      reachable: !!keyInfo,
      error,
      // Sub-account management + wallet rights the exchange itself depends on
      canManageSubAccounts: !!keyInfo && (keyInfo.type === 1 || has(perms.Wallet, 'SubMemberTransfer')),
      canTransfer: has(perms.Wallet, 'AccountTransfer') || has(perms.Wallet, 'SubMemberTransfer'),
      canWithdraw: has(perms.Wallet, 'Withdraw'),
      permissions: perms,
      ips: keyInfo?.ips,
      expiredAt: keyInfo?.expiredAt,
      isMaster: keyInfo?.isMaster,
    },
    services,
    markets: { spot: config.spotSymbols, linear: config.linearSymbols },
    depositAssets: config.depositAssets,
  };
  cache = { at: Date.now(), data };
  return data;
}

/** Permission set to request when creating a user's sub-account API key. */
export function subAccountPermissions(services) {
  const perms = { Wallet: ['AccountTransfer'] };
  for (const [id, s] of Object.entries(services)) {
    if (!s.live) continue;
    for (const [k, v] of Object.entries(SERVICE_DEFS[id].subPerm)) {
      perms[k] = Array.from(new Set([...(perms[k] || []), ...v]));
    }
  }
  return perms;
}

export function liveCategories(services) {
  return Object.values(services).filter((s) => s.live).map((s) => s.id).filter((id) => ['spot', 'linear', 'inverse', 'option'].includes(id));
}
