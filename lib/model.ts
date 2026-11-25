// Token Radar, model "radar-2": score every pre-token protocol from the snapshot's
// own figures, never from a hand-written list of names.
//
//   implied_value_usd = round( TVL^0.9 x 0.25 x categoryWeight x growthMult x maturityMult )
//
// TVL enters log-compressed (power 0.9) so a giant protocol does not swallow the board.
// growthMult  = 1 + clamp(change_7d, -50, +150) / 100 x 0.6   (a hot week lifts, a cold week cuts)
// maturityMult = 0.70 + min(age_days, 1460) / 1460 x 0.50      (0.70..1.20; longer running
//                  with no token recorded = more pent-up launch value; unknown age counts as 365)
// categoryWeight: Dexs 1.15, Lending 1.12, Derivatives 1.10, Yield 1.06, Yield Aggregator 1.06,
//   RWA 1.05, Onchain Capital Allocator 1.04, Risk Curators 1.03, everything else 1.00,
//   Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC 0.85
//   (bridges and staking wrappers rarely launch a fresh token of their own).
//
// The board ranks pre-token protocols only: the snapshot's watchlist (the floor) plus the
// strongest pre-token protocols below the floor, by TVL. Protocols whose token already trades
// (mcap_usd recorded) are kept apart in the Live set and shown at their actual market cap,
// never mixed into the ranked board. Early rows also pass the watchlist's own wrapped /
// staked / bridged / exchange-product rule, so a product of a token that already trades
// (WBTC, Binance staked ETH, a bridge) never ranks as a protocol still to launch one.

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

export interface ModelConstants {
  tvl_power: number;
  tvl_factor: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  weights: Record<string, number>;
  bridge_weight: number;
}

export const MODEL: ModelConstants = {
  tvl_power: 0.9,
  tvl_factor: 0.25,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  weights: {
    Dexs: 1.15,
    Lending: 1.12,
    Derivatives: 1.1,
    Yield: 1.06,
    'Yield Aggregator': 1.06,
    RWA: 1.05,
    'Onchain Capital Allocator': 1.04,
    'Risk Curators': 1.03,
  },
  bridge_weight: 0.85,
};

export const MODEL_VERSION = 'radar-2';

/** Rankable pre-token protocols the watchlist does not name, carried by the early radar, by TVL. */
export const EARLY_ROWS = 260;

/** Live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;
const BRIDGE_CATS = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category weight for one protocol, from the model's table. */
export function categoryWeight(category: string | null, model: ModelConstants): number {
  if (category === null) return 1;
  if (BRIDGE_CATS.has(category)) return model.bridge_weight;
  return model.weights[category] ?? 1;
}

/** The implied value and its parts for one protocol under the model. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; catWeight: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const catWeight = categoryWeight(p.category, model);
  const base = Math.pow(p.tvl_usd, model.tvl_power) * model.tvl_factor;
  const implied = Math.max(1, Math.round(base * catWeight * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, catWeight, age };
}

/** A protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a version marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol the watchlist does not name may join the early radar: the same
 * wrapped / staked / bridged / exchange-product rule the house's watchlist uses, so a
 * product of a token that already trades (WBTC, Binance staked ETH, a bridge) never
 * ranks as a protocol still to launch one. Watchlist rows themselves are never filtered.
 */
export function isEarlyEligible(p: SnapshotProtocol): boolean {
  return (
    isRankable(p) &&
    !(p.category !== null && WRAPPED_CATS.has(p.category)) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    tvl_power: number;
    category_weight: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_weight: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The board: watchlist first as the floor, then the strongest pre-token early rows, ranked by value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyEligible(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      tvl_power: model.tvl_power,
      category_weight: s.catWeight,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** Live-token protocols, by market cap, shown at the market's own value. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      mcap_usd: row.mcap_usd,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      category_weight: row.model.category_weight,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      farm_steps: row.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans

/** A small stable hash of a slug, used only to vary the weekly action between protocols. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** Typical gas for one transaction on a chain, in dollars, as a short phrase. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('solana')) return 'about $0.05 of fees';
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('linea') || c.includes('scroll') || c.includes('zksync') || c.includes('blast') || c.includes('mode'))
    return 'about $0.30 of gas';
  if (c.includes('polygon') || c.includes('bsc') || c.includes('avalanche') || c.includes('fantom') || c.includes('gnosis'))
    return 'about $0.50 of gas';
  if (c.includes('ethereum')) return 'about $8 of gas';
  return 'about $2 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} as collateral, borrow a small amount against it, then repay the borrow.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain}, in a balanced pair, and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the app it lands on.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small hedged position, then close it.`;
  if (c.includes('prediction'))
    return `Fund your account with $${capital} on ${name} on ${chain} and take one position in a market that resolves soon.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares for the full season.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's own app.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active through the season.`;
  if (c.includes('options'))
    return `Write or buy one small options position worth $${capital} on ${name} on ${chain} and let it settle.`;
  if (c.includes('farm'))
    return `Deposit $${capital} into ${name}'s main farm on ${chain} and stake the receipt to earn its points.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use its main feature once a week.`;
}

/** The weekly qualifying action, varied per protocol so plans are not one repeated template. */
const WEEKLY = [
  'Make one qualifying action each week: a deposit, a swap, a borrow or a vote in the protocol\'s own app.',
  'Do one small transaction each week on the protocol, alternating a deposit, a swap and a claim so the activity looks organic.',
  'Return once a week to compound, re-stake or top up the position by a small amount, and keep the wallet active.',
];

function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for updates.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and varied by its slug, never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const weekly = WEEKLY[slugHash(p.slug) % WEEKLY.length]!;
  const steps: string[] = [
    stepText(
      `Use a fresh wallet that holds only the funds you plan to farm on ${p.name}, and keep its seed phrase offline.`,
      'under $3 for the first transaction',
      '5 minutes',
    ),
    stepText(mainAction(p, capital, chain), `$${capital} of capital and ${gas}`, '15 minutes to set up'),
  ];
  if (second !== null) {
    steps.push(
      stepText(
        `Repeat the same position on ${second} with $${Math.max(25, Math.round(capital / 2))} so the farm covers a second chain the protocol supports.`,
        `$${Math.max(25, Math.round(capital / 2))} of capital and ${gasFor(second)}`,
        '15 minutes',
      ),
    );
  } else {
    steps.push(
      stepText(
        `Split the position: keep half in the main pool on ${chain} and move the other half into the protocol's second-largest pool.`,
        `$${capital} of capital in total and ${gas}`,
        '10 minutes',
      ),
    );
  }
  steps.push(stepText(weekly, `${gas} a week`, '10 minutes a week'));
  steps.push(
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
  );
  steps.push(
    stepText(
      `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only there; never pay anyone to claim for you.`,
      'no fee to check',
      '10 minutes',
    ),
  );
  return steps;
}

// ---------------------------------------------------------------- parsing and checks

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
