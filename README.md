# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mengmeng-ai/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mengmeng-ai/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks the protocols whose token does not exist yet by an implied value, and shows a reader how to farm each one. It reads a sealed DefiLlama snapshot (758 protocols as of 2026-11-14), covers all 40 protocols on the snapshot's watchlist plus the strongest pre-token protocols below the $50M floor, and keeps the protocols whose token already trades apart in a Live view at their actual market cap. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## The model (radar-2)

Implied value = TVL^0.9 × 0.25 × category weight × growth × maturity, from the snapshot's own figures only — no protocol name is special-cased:

- **TVL, log-compressed:** TVL^0.9 × 0.25, so size matters but a giant does not swallow the board.
- **Category weight:** Dexs 1.15 · Lending 1.12 · Derivatives 1.10 · Yield 1.06 · Yield Aggregator 1.06 · RWA 1.05 · Onchain Capital Allocator 1.04 · Risk Curators 1.03 · other 1.00 · Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC 0.85.
- **Growth:** 1 + clamp(7-day TVL change, −50%, +150%) ÷ 100 × 0.6.
- **Maturity:** 0.70 + min(age in days, 1460) ÷ 1460 × 0.50 — the longer a protocol runs with no token recorded, the more pent-up launch value; unknown age counts as 365 days.

Each row carries a six-step farm plan generated from the protocol's category, chains, TVL and age, with what each step costs and how long it takes. An implied value is this entry's own claim: it does not predict whether or when a token is issued, and a protocol that records no token may still have one its DefiLlama record does not carry.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json` with the vendored make.fun library. Open `out/dashboard/index.html` in a browser: sort and filter the board, click any row for its detail view and farm plan.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data and dossier.
- `lib/model.ts` — the radar-2 model, farm-plan generator and board checks.
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js` (no network, no framework).
- `screenshots/` — board, detail and filtered views of the dashboard.

<sub>Entered on [make.fun](https://make.fun/?ref=d5a50dzy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
