# Operations

How data gets into this system, and how to run it.

## The pipeline

```
  ingest ──────────────► sales ──────► pricing engine ──────► current_prices
  (worker / backfill)              (reprocess --phase=2)      (what the site serves)
```

Ingest and pricing are **deliberately separate**. Pricing the whole table takes
~30s when done in one pass; interleaving it with scraping made it ~80% of the
runtime. Scrape first, price after.

## Data sources

| Source | Covers | Cost | Status |
|---|---|---|---|
| **TCGdex** | ungraded/raw, all variants | free, no key | **active** — whole catalogue in ~8 min |
| PriceCharting scrape | graded (PSA/CGC/BGS/SGC) | free, ~18h/pass | **active** |
| eBay Marketplace Insights | graded + raw sold comps | — | **DENIED** — application rejected |
| eBay Browse API | — | — | removed; returns ACTIVE listings, do not reintroduce |
| pokemontcg.io | ungraded | now Scrydex, commercial | **abandoned** — see below |

**Why TCGdex over pokemontcg.io.** pokemontcg.io was absorbed into Scrydex, which
sells the same data for $29-399/month. Its legacy free endpoint still responds but
returns HTTP 500 on roughly four of five requests, and is owned by a company with
an obvious reason to close it. TCGdex is open source, needs no key, and answers in
~115ms instead of 3-10s. Note that `docs.pokemontcg.io` still documents the old
free tier — that documentation is stale.

**eBay Marketplace Insights: application DENIED.** eBay reserves it for major
partners; an active seller account was not enough. The client remains in the tree
because it costs nothing and would switch on with no code change, but there is no
path here. Sold-comp data is not available to us from eBay.

**Do not raise the scrape rate.** PriceCharting put us behind Cloudflare's bot
challenge after ~11,500 requests in one day at ~0.9 req/s. It cleared on its own,
but the worker now defaults to 2 concurrent at a 3s gap with a 5,000/day cap, and
has a circuit breaker that aborts after 25 consecutive blocks and backs off. That
is a deliberate trickle. Since TCGdex now covers all ungraded pricing, this host
is only needed for graded prices on cards where graded prices matter.

Check eBay status any time:

```bash
npx tsx src/scripts/check-ebay-access.ts
```

When that prints `GRANTED`, the eBay path switches on with no code change —
`src/lib/sources/ebay-insights.ts` already implements the `SoldDataSource`
interface and `/api/cron/scrape` already gates on availability.

> The Browse API cannot substitute. It has no sold filter, and
> `findCompletedItems` was decommissioned in February 2025. Rows previously
> ingested from Browse were asking prices averaging ~1.28x true sold prices;
> they have been deleted and the code paths are marked `@deprecated`.

## Running the worker

Bulk scraping does not fit Vercel (60s function cap) and shouldn't depend on a
laptop. Run it on a small always-on box:

```bash
npx tsx src/scripts/worker.ts
```

It loops forever with a tiered strategy: **fill** unpriced cards first (highest
`scrape_priority` first), then **refresh** anything older than `--refresh-days`.
It handles SIGINT/SIGTERM by finishing the current batch, and every step is an
upsert, so killing it never leaves partial state.

| Flag | Default | Notes |
|---|---|---|
| `--batch` | 300 | cards per cycle |
| `--concurrency` | 3 | workers; does **not** raise request rate |
| `--gap` | 1100 | ms between requests, global across workers |
| `--refresh-days` | 7 | age before a priced card is re-scraped |
| `--once` | off | run a single cycle and exit |

**Do not lower `--gap` much.** PriceCharting returns 429 above roughly 1 req/s;
at 250ms we measured a ~70% failure rate. Concurrency hides latency, it does not
buy throughput — the request rate is set by `--gap` alone. A full pass over 58k
cards is ~18 hours, and that ceiling is theirs, not ours.

Then price what was ingested:

```bash
npx tsx src/scripts/reprocess-sales.ts --phase=2
```

## Keeping the site current, for free

Three jobs, no paid APIs:

```bash
# 1. Ungraded prices for the whole catalogue — ~8 minutes. Run daily.
npx tsx src/scripts/sync-reference-prices.ts --concurrency 8
npx tsx src/scripts/apply-reference-prices.ts

# 2. Graded prices — run the worker continuously.
#    58,029 cards at ~0.9 cards/s is ~18h, so a full pass fits inside a day.
npx tsx src/scripts/worker.ts

# 3. Recompute prices from whatever the worker ingested. Run daily, after (2).
npx tsx src/scripts/reprocess-sales.ts --phase=2
```

Use `--stale-hours 20` on the reference sync for a daily refresh that skips rows
already updated today.

### As a systemd unit

```ini
[Unit]
Description=TCGiant ingest worker
After=network-online.target

[Service]
WorkingDirectory=/srv/tcgiant-pricing
ExecStart=/usr/bin/npx tsx src/scripts/worker.ts
Restart=always
RestartSec=30
EnvironmentFile=/srv/tcgiant-pricing/.env.local

[Install]
WantedBy=multi-user.target
```

## API keys

Keys are stored as SHA-256 hashes; the raw key is shown once at creation and
cannot be recovered.

```bash
npx tsx src/scripts/manage-api-keys.ts create --email you@example.com --tier pro --name "TCGiant Gacha"
npx tsx src/scripts/manage-api-keys.ts list
npx tsx src/scripts/manage-api-keys.ts usage --prefix tcg_1a2b
npx tsx src/scripts/manage-api-keys.ts revoke --prefix tcg_1a2b
```

| Tier | per minute | per day |
|---|---|---|
| free | 30 | 1,000 |
| basic | 120 | 20,000 |
| pro | 600 | 200,000 |
| internal | effectively unlimited | |

`INTERNAL_API_KEY` still works and bypasses both limits and the database
lookup — that is the key TCGiant's own apps should use.

Rate-limit counters live in `api_usage`, not in memory: a serverless instance
cannot share an in-process counter, and a cold start would reset it. Windows
older than two days are pruned by `pruneUsageWindows()`.

## One-off scripts

| Script | Purpose |
|---|---|
| `backfill-history.ts` | bounded manual scrape; supports `--set`, `--unpriced-only`, `--stale-days`, `--limit` |
| `reprocess-sales.ts` | `--phase=1` re-parse grades · `--phase=2` reprice · `--phase=3` drop variant mismatches · no flag runs all |
| `set-scrape-priority.ts` | recompute `cards.scrape_priority` |
| `check-ebay-access.ts` | report eBay sold-data access |
| `apply-source-column.ts` | one-time; migration 0004 applied in batches |
| `optimize-storage.ts` | drop unused indexes, clear redundant `ebay_url`, vacuum |
| `manage-api-keys.ts` | issue, list, revoke and inspect API keys |

All support `--dry-run` where they write.

## Things that will bite you

**Large `UPDATE`s over `sales` must be batched.** Postgres writes a new row
version and leaves the old one dead, so a full-table update momentarily needs a
second copy of the table. On the old free tier this hit the project size limit
and rolled back; it is still worth avoiding a 300 MB write amplification.
`apply-source-column.ts` shows the pattern (batch + `VACUUM` between batches).

**`VACUUM` does not shrink files, `VACUUM FULL` does.** Plain `VACUUM` marks
space reusable inside the table; `pg_database_size` still counts it. After a
bulk delete or column clear, run `VACUUM FULL <table>` to actually return the
space — it needs a temporary second copy, so check headroom first. Doing this
after clearing `ebay_url` took the database from 390 MB to 250 MB.

**Storage projection.** At ~275 bytes per sale row and ~143 sales per card,
full realistic coverage (~24,000 scrapeable cards) is roughly 950 MB. Neon
storage is billed around $0.35/GB-month, so storage is not the cost driver —
compute is.

**`CRON_SECRET` is required.** `/api/cron/scrape` returns 503 without it, by
design — it used to be publicly callable.

**`scrape_priority < 0` means "PriceCharting doesn't have this card."** The
worker skips those. They accumulate from confirmed slug misses (basic energies,
reverse-holo variants PriceCharting doesn't split, name mismatches). Reset with
`set-scrape-priority.ts` if you want to retry them.
