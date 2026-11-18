// Radar model for token-radar-01: score every pre-token protocol in the sealed
// snapshot and write the ranked board plus the dashboard's data script.
//
// The model is deliberately snapshot-native. Nothing here names a protocol:
// the benchmark multiple comes from the protocols in the same snapshot that
// already record a token, and every adjustment comes from the row's own TVL,
// 7-day change, listing date, chain count and category peers.
//
//   implied value = TVL x benchmark x growth x age x breadth x category
//
// benchmark  median mcap/TVL over token-bearing protocols with a market cap
// growth     7-day TVL change, clamped to [-50, +100]%, scaled by 1/250
// age        days listed up to the snapshot date, capped at 4 years
// breadth    one extra chain adds 2%, capped at 8 extra chains
// category   the protocol's category peers' median 7-day change vs the
//            whole snapshot's median, clamped to +/-10 points, scaled 1/200
//
// A protocol records no token when both gecko_id and symbol are null. The
// board only ranks those that are also not a wrapped, staked or bridged
// product of a token that already trades: the same exclusions the
// watchlist's rule uses (excluded categories, version-marked names,
// wrapped/staked/staking words, exchange-prefixed names). Token-bearing
// protocols are counted and reported, never ranked.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  days_listed: number;
  on_watchlist: boolean;
  benchmark: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  category_factor: number;
}

export interface RadarMeta {
  as_of: string;
  floor_usd: number;
  protocols_total: number;
  token_bearing: number;
  pre_token_eligible: number;
  watchlist_total: number;
  benchmark_median_mcap_tvl: number;
  median_change_7d: number;
  median_days_listed: number;
}

export interface RadarResult {
  rows: BoardRow[];
  meta: RadarMeta;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when the protocol looks like a wrapped/staked/bridged product of a token that already trades. */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

export function eligiblePreToken(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isDerivativeProduct(p);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days between two YYYY-MM-DD dates, never negative. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** The core on-protocol action for a category, as a verb phrase a farmer can do. */
function coreAction(category: string | null): string {
  switch (category) {
    case 'Dexs': return 'swap and add liquidity in a pool';
    case 'Lending': return 'supply assets and borrow a small amount against them';
    case 'Yield': return 'deposit into a vault and let the strategy compound';
    case 'Yield Aggregator': return 'deposit into a vault and let the strategy compound';
    case 'Derivatives': return 'open and close a small leveraged position';
    case 'Perps': return 'open and close a small perpetual position';
    case 'Liquid Staking': return 'stake and hold the receipt token';
    case 'RWA': return 'buy a small allocation of a tokenised real-world asset';
    case 'Restaking': return 'restake your stake through the protocol';
    case 'Bridge': return 'bridge a small amount across chains';
    case 'Risk Curators': return 'deposit into a curated vault';
    case 'Onchain Capital Allocator': return 'allocate capital to a vault';
    case 'Basis Trading': return 'deposit into the basis strategy';
    case 'CDP': return 'mint the stable asset against collateral';
    case 'Algo-Stables': return 'mint and hold the algorithmic stable asset';
    case 'Farm': return 'stake LP tokens in a farm';
    case 'Prediction Market': return 'place a small prediction on an open market';
    case 'NFT Lending': return 'lend against an NFT or borrow against one you hold';
    case 'Options': return 'buy or write a small options position';
    case 'Insurance': return 'buy cover for a position you already hold';
    case 'Indexes': return 'buy a small amount of the index token';
    case 'Payments': return 'send a payment through the protocol';
    case 'Privacy': return 'make a private transfer through the protocol';
    case 'Launchpad': return 'join a launch allocation';
    case 'Gaming': return 'play a session and hold the in-game assets';
    case 'Social': return 'post and engage through the protocol daily';
    default: return 'use the protocol\'s main product with a real position';
  }
}

/** A second, distinct weekly habit for a category. */
function weeklyHabit(category: string | null): string {
  switch (category) {
    case 'Dexs': return 'route one real swap through it each week instead of your usual exchange';
    case 'Lending': return 'adjust your supplied collateral once a week and keep your borrow under 40% of it';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Risk Curators':
    case 'Onchain Capital Allocator': return 'check the vault\'s yield and rebalance into its best-performing strategy once a week';
    case 'Derivatives':
    case 'Perps':
    case 'Options': return 'close each position within a week and open the next one only after reviewing the fees paid';
    case 'RWA': return 'review the underlying asset\'s reporting once a week and add only on a fresh report';
    case 'Restaking': return 'check your restaked position and any new operator options once a week';
    case 'Prediction Market': return 'settle one market a week and record which of your calls were right';
    default: return 'repeat the core action once a week and vary the amount slightly each time';
  }
}

function farmSteps(p: SnapshotProtocol, daysListed: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const chainNote = p.chains.length > 1
    ? `${chain} (it also runs on ${p.chains.length - 1} other chain${p.chains.length - 1 === 1 ? '' : 's'})`
    : chain;
  const cat = p.category ?? 'DeFi';
  const action = coreAction(p.category);
  const habit = weeklyHabit(p.category);
  const size = p.tvl_usd >= 1_000_000_000 ? '$250-$1,000' : p.tvl_usd >= 100_000_000 ? '$100-$500' : '$50-$250';
  const years = (daysListed / 365).toFixed(1);
  const yearWord = Number(years) > 1 ? 'years' : 'year';
  return [
    `Set up a fresh farming wallet, fund it on ${chainNote} with ${size} plus about $10 for gas, and keep it separate from your main holdings; this takes about 15 minutes and costs roughly $2-$5 in gas.`,
    `On ${p.name}, ${action} with ${size} and leave the position open for at least 2 weeks, so the protocol records sustained use rather than a single visit; expect $1-$4 in fees per action.`,
    `${habit.charAt(0).toUpperCase() + habit.slice(1)} for 4-6 weeks, spending about 20 minutes a week, and keep a simple log of dates, amounts and transaction hashes.`,
    `Check ${p.name}'s points, quests or rewards page once a week (5 minutes) and finish any listed on-chain task the same day; the protocol has run for about ${years} ${yearWord} with no token recorded, so a long, steady history matters more than one big deposit.`,
    `Stay safe: never farm with money you cannot lose, revoke token approvals when you stop, and if a token ever launches, exit in 2-3 tranches over a week instead of selling everything in one transaction.`,
  ];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

export function buildRadar(snapshot: Snapshot): RadarResult {
  const watch = new Set(snapshot.watchlist);
  const tokenBearing = snapshot.protocols.filter((p) => !recordsNoToken(p));
  const withMcap = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const benchmark = median(withMcap.map((p) => p.mcap_usd! / p.tvl_usd));
  const allChanges = snapshot.protocols
    .map((p) => p.change_7d)
    .filter((c): c is number => c !== null);
  const medianChange = median(allChanges);
  const listedDays = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .map((p) => daysBetween(p.listed_at!, snapshot.as_of));
  const medianAge = median(listedDays);

  // Category peers' median 7-day change, from the snapshot itself.
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.change_7d === null) continue;
    const key = p.category ?? '(none)';
    const arr = byCategory.get(key) ?? [];
    arr.push(p.change_7d);
    byCategory.set(key, arr);
  }
  const categoryMedian = new Map<string, number>();
  for (const [key, arr] of byCategory) categoryMedian.set(key, median(arr));

  const eligible = snapshot.protocols.filter(eligiblePreToken);
  const rows: BoardRow[] = eligible.map((p) => {
    const days = p.listed_at === null ? Math.round(medianAge) : daysBetween(p.listed_at, snapshot.as_of);
    const growth = clamp(p.change_7d ?? 0, -50, 100);
    const growthFactor = 1 + growth / 250;
    const ageFactor = 0.75 + 0.45 * (Math.min(days, 1460) / 1460);
    const breadthFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 8);
    const catMed = categoryMedian.get(p.category ?? '(none)') ?? medianChange;
    const categoryFactor = 1 + clamp(catMed - medianChange, -10, 10) / 200;
    const value = Math.max(
      1,
      Math.round(p.tvl_usd * benchmark * growthFactor * ageFactor * breadthFactor * categoryFactor),
    );
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value,
      farm_steps: farmSteps(p, days),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      days_listed: days,
      on_watchlist: watch.has(p.slug),
      benchmark,
      growth_factor: growthFactor,
      age_factor: ageFactor,
      breadth_factor: breadthFactor,
      category_factor: categoryFactor,
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  // Enforce strictly non-increasing values so the ranking is unambiguous.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    row.rank = i + 1;
    if (i > 0 && row.implied_value_usd >= rows[i - 1]!.implied_value_usd) {
      row.implied_value_usd = Math.max(1, rows[i - 1]!.implied_value_usd - 1);
    }
  }

  return {
    rows,
    meta: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      protocols_total: snapshot.protocols.length,
      token_bearing: tokenBearing.length,
      pre_token_eligible: eligible.length,
      watchlist_total: snapshot.watchlist.length,
      benchmark_median_mcap_tvl: benchmark,
      median_change_7d: medianChange,
      median_days_listed: Math.round(medianAge),
    },
  };
}

/** First gate failure found in a board, or null when the board is valid. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100-4000`;
  const seen = new Set<string>();
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    if (r.rank !== i + 1) return `rank ${r.rank} is not ${i + 1}`;
    if (!slugs.has(r.slug)) return `row ${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${r.slug} has a bad implied value`;
    if (i > 0 && r.implied_value_usd > sorted[i - 1]!.implied_value_usd) return `value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} chars`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}

/** The dashboard's data file: one script, window.RADAR, with meta + rows. */
export function dataScript(result: RadarResult): string {
  const compact = result.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    value: r.implied_value_usd,
    tvl: r.tvl_usd,
    change7d: r.change_7d,
    listed: r.listed_at,
    days: r.days_listed,
    cat: r.category,
    chains: r.chains,
    watch: r.on_watchlist,
    gf: Number(r.growth_factor.toFixed(4)),
    af: Number(r.age_factor.toFixed(4)),
    bf: Number(r.breadth_factor.toFixed(4)),
    cf: Number(r.category_factor.toFixed(4)),
    steps: r.farm_steps,
  }));
  const payload = { meta: result.meta, rows: compact };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}

/** Short money label, shared by the dashboard's model note. */
export function formatMoney(n: number): string {
  return money(n);
}
