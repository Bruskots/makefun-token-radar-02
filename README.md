# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Bruskots/makefun-token-radar-02/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Bruskots/makefun-token-radar-02/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` competition. It reads a
sealed DefiLlama snapshot of 758 protocols, finds the ones that record no
token and are not a wrapped, staked or bridged product of a token that already
trades, ranks them by an implied launch value, and hands in a dashboard that
shows the board, a detail view per protocol and the steps to farm each one.

## The value model

No protocol is named by hand. The model is derived from the snapshot itself:

```
implied value = TVL × benchmark × growth × age × breadth × category
```

- **benchmark** — the median market-cap-to-TVL ratio of the protocols in
  the same snapshot that already record a token. The multiple is the
  market's own, not a picked number.
- **growth** — the protocol's 7-day TVL change, clamped to −50%…+100%,
  scaled by 1/250 (a factor of 0.80–1.40).
- **age** — days listed up to the snapshot date, capped at 4 years
  (a factor of 0.75–1.20). A protocol that has run a long time with no token
  recorded is a steadier subject than a week-old one.
- **breadth** — one extra chain adds 2%, capped at 8 extra chains.
- **category** — the protocol's category peers' median 7-day change versus
  the whole snapshot's median, clamped to ±10 points, scaled by 1/200.

Protocols that already record a token are counted and set aside — they are
not launches waiting to happen. “Records no token” means the snapshot
carries no token for the protocol; it is not proof that none exists.

The board ranks all 198 eligible pre-token protocols: the 40 on the
watchlist plus 158 early ones below the $50M floor.

## Farm plans

Every row carries five concrete steps: set up a separate farming wallet and
fund it, use the protocol's core product with a stated size for at least two
weeks, repeat a category-specific weekly habit for 4–6 weeks, check the
points or quests page weekly, and stay safe (position sizing, revoking
approvals, exiting in tranches). Steps name costs and time, not slogans.

## Run it

Node 22 or later, standard library only — nothing to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. The run is deterministic: the
same snapshot bytes always produce the same output bytes.

## Local verification (2026-11-18)

Against the kit snapshot, the program writes 198 rows (the 40 watchlist
protocols plus 158 early ones below the floor), ranks 1–198 with
non-increasing implied values, and every row carries 5 farm steps of valid
length. The dashboard is 3 files, 16,303 bytes, with no network addresses;
the 3 screenshots are 1440×900 PNGs of about 180 KB each; `dossier.json`
(749,506 bytes) is byte-identical to what the kit's own `buildDossier`
writes from the same output, and two runs produce byte-identical outputs.

## Layout

- `main.ts` — entrypoint: reads the snapshot, checks the board, writes the outputs.
- `lib/radar.ts` — the model, the farm-plan builder and the dashboard data script.
- `vendor/makefun-board.ts` — the dossier builder (`buildDossier`), this
  entry's own implementation of the `makefun/dossier/v1` contract.
- `dashboard/` — the static page: `index.html`, `style.css`, `app.js`. It
  reads `../data.js` (a relative path, no network) and renders the board,
  filters, sorting and a detail view per protocol. Deep links:
  `#detail=<slug>`, `#watch=1`, `#q=<text>`, `#cat=<category>`.
- `screenshots/` — board, detail and filtered views of the dashboard.

## License

MIT — see `LICENSE`.
